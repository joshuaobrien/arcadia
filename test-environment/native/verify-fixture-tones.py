#!/usr/bin/env python3
"""Decode actual pinned-image fixture MP3 output; no app, VM or server is started."""
import argparse
import array
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import uuid


def run(*arguments):
    return subprocess.check_output(list(map(str, arguments)))


def inspect_window(raw, expected_hz):
    samples = array.array('f')
    samples.frombytes(raw)
    if len(samples) < 47_000:
        raise AssertionError('Insufficient actual decoded samples')
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    power = {}
    for hz in [520, 600, 680]:
        coefficient = 2 * math.cos(2 * math.pi * hz / 48_000)
        first = second = 0.0
        for value in samples:
            next_value = value + coefficient * first - second
            second, first = first, next_value
        power[hz] = max(0, first * first + second * second - coefficient * first * second) / len(samples) ** 2
    strongest = max(power, key=power.get)
    passed = rms > 0.01 and strongest == expected_hz and power[expected_hz] > 3 * max(
        value for hz, value in power.items() if hz != expected_hz)
    return {'samples': len(samples), 'rms': rms, 'expected_hz': expected_hz,
            'strongest_hz': strongest, 'power': power, 'passed': passed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).with_name('jellyfin.py')
    specification = importlib.util.spec_from_file_location('jellyfin_fixture', source)
    fixture = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(fixture)
    name = 'arcadia-tone-probe-' + uuid.uuid4().hex[:12]
    owner = str(root)
    ffmpeg = '/usr/lib/jellyfin-ffmpeg/ffmpeg'
    report = {'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'probe_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'image': fixture.IMAGE, 'container': name, 'windows': [], 'media': {}}
    created = False
    try:
        report['image_id'] = run('docker', 'image', 'inspect', fixture.IMAGE, '--format', '{{.Id}}').decode().strip()
        run('docker', 'run', '-d', '--pull', 'never', '--name', name, '--network', 'none', '--cpus', '1',
            '--label', 'arcadia.tone-probe=' + owner, '--entrypoint', '/bin/sh', fixture.IMAGE, '-c', 'sleep 300')
        created = True
        report['ffmpeg_version'] = run('docker', 'exec', name, ffmpeg, '-version').decode().splitlines()[0]
        for label, album, track, sustained in [('first', 1, 1, None), ('sustained', 1, 2, 300)]:
            media = '/tmp/' + label + '.mp3'
            command = ['docker', 'exec', name, ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                       '-f', 'lavfi', '-i', fixture.audio_input(album, track, sustained),
                       '-threads', '1', '-c:a', 'libmp3lame', media]
            run(*command)
            run('docker', 'cp', name + ':' + media, root / (label + '.mp3'))
            duration = float(run('docker', 'exec', name, '/usr/lib/jellyfin-ffmpeg/ffprobe',
                                 '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'default=noprint_wrappers=1:nokey=1', media))
            expected_duration = 30 if label == 'first' else 300
            report['media'][label] = {'duration_seconds': duration, 'expected_duration': expected_duration,
                                      'duration_passed': abs(duration - expected_duration) < 0.15,
                                      'sha256': hashlib.sha256((root / (label + '.mp3')).read_bytes()).hexdigest(),
                                      'generation_command': command}
        # Independent consumer contract: First Contact at2s=520, at18s=680;
        # sustained mode remains600Hz both early and near the end of300seconds.
        for label, second, hz in [('first', 2, 520), ('first', 18, 680),
                                  ('sustained', 2, 600), ('sustained', 298, 600)]:
            raw = run('docker', 'exec', name, ffmpeg, '-hide_banner', '-loglevel', 'error',
                      '-ss', str(second), '-i', '/tmp/' + label + '.mp3', '-t', '1',
                      '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1')
            (root / f'{label}-{second}s.f32le').write_bytes(raw)
            evidence = inspect_window(raw, hz)
            evidence.update(media=label, start_seconds=second)
            report['windows'].append(evidence)
        report['passed'] = (all(window['passed'] for window in report['windows'])
                            and all(media['duration_passed'] for media in report['media'].values()))
    finally:
        if created:
            actual = run('docker', 'inspect', '--format', '{{index .Config.Labels "arcadia.tone-probe"}}', name).decode().strip()
            if actual != owner:
                raise RuntimeError('Container ownership changed; refusing cleanup')
            run('docker', 'rm', '-f', '-v', name)
            report['owned_container_removed'] = True
        (root / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    if not report.get('passed'):
        raise SystemExit('FAIL: actual decoded fixture tones violate the consumer contract; inspect manifest.json')
    print('PASS: decoded first-track520/680 and sustained600Hz contract; owned container removed')


if __name__ == '__main__':
    main()
