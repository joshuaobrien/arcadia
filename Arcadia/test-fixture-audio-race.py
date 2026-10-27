#!/usr/bin/env python3
"""Check cross-process fixture publication inside a disposable macOS test VM."""
from pathlib import Path
import subprocess
import tempfile
import uuid


PROBE = r'''
import AVFoundation
import Darwin
import Foundation

struct Track { let id: String }
enum MusicSourceError: Error { case invalidResponse }

let mode = CommandLine.arguments[1]
let track = Track(id: CommandLine.arguments[2])
let path = FileManager.default.temporaryDirectory
  .appendingPathComponent("arcadia-fixture-audio")
  .appendingPathComponent(track.id).appendingPathExtension("wav")
if mode == "read" {
  print("READY")
  fflush(stdout)
  let deadline = Date().addingTimeInterval(10)
  while !FileManager.default.fileExists(atPath: path.path) {
    guard Date() < deadline else { print("Fixture was never published"); exit(4) }
    usleep(100)
  }
}
do {
  // Use the actual fixture API, not a substitute writer or audio backend.
  let url = try FixtureAudio.url(for: track)
  let file = try AVAudioFile(forReading: url)
  guard file.length == 576_000 else {
    print("Incomplete published fixture: \(file.length) frames")
    exit(2)
  }
  print("VALID")
} catch {
  print("Unreadable published fixture: \(error)")
  exit(3)
}
'''


def main():
    model = subprocess.check_output(['sysctl', '-n', 'hw.model'], text=True).strip()
    if not model.startswith('VirtualMac'):
        raise SystemExit('Run this native regression command inside the disposable macOS VM')
    fixture = Path(__file__).resolve().parent / 'Arcadia/Development/FixtureAudio.swift'
    with tempfile.TemporaryDirectory(prefix='arcadia-fixture-race-') as tmp:
        root = Path(tmp)
        source = root / 'main.swift'
        source.write_text(PROBE)
        probe = root / 'probe'
        subprocess.run(['xcrun', 'swiftc', '-D', 'DEBUG', str(fixture), str(source), '-o', str(probe)], check=True, timeout=60)
        failures = 0
        for attempt in range(10):
            identity = 'publication-race-' + uuid.uuid4().hex
            reader = subprocess.Popen([str(probe), 'read', identity], stdout=subprocess.PIPE,
                                      stderr=subprocess.STDOUT, text=True)
            writers = []
            try:
                if reader.stdout.readline().strip() != 'READY':
                    raise RuntimeError('Fixture reader did not become ready')
                # Independent test workers may both miss the cache simultaneously.
                writers = [subprocess.Popen([str(probe), 'write', identity], stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, text=True) for _ in range(2)]
                writer_failed = False
                for writer in writers:
                    output = writer.communicate(timeout=15)[0]
                    if writer.returncode:
                        writer_failed = True
                        print('Fixture writer failed: ' + output, flush=True)
                output = reader.communicate(timeout=15)[0].strip()
                failures += writer_failed or reader.returncode != 0
                print(f'Publication race {attempt + 1}/10: {output}', flush=True)
            finally:
                if reader.poll() is None:
                    reader.kill()
                    reader.communicate()
                for writer in writers:
                    if writer.poll() is None:
                        writer.kill()
                        writer.communicate()
                directory = Path(tempfile.gettempdir()) / 'arcadia-fixture-audio'
                (directory / (identity + '.wav')).unlink(missing_ok=True)
        if failures:
            raise SystemExit(f'{failures}/10 readers observed incomplete published audio')
        print('10/10 readers received complete audio across independent worker processes')


if __name__ == '__main__':
    main()
