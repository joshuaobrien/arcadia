#!/usr/bin/env python3
"""Build and verify the committed tap-only capture helper inside an owned guest."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parent.parent / 'audio-capture.swift'
PLIST = SOURCE.with_suffix('.plist')
SCHEMA = 1


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def discover_toolchain():
    def query(*arguments):
        return subprocess.check_output(arguments, text=True, timeout=30).strip()
    compiler = Path(query('xcrun', '--sdk', 'macosx', '--find', 'swiftc'))
    return {'compiler': str(compiler), 'compiler_realpath': str(compiler.resolve()), 'compiler_version': query(str(compiler), '--version'),
            'compiler_sha256': sha256(compiler),
            'sdk': query('xcrun', '--sdk', 'macosx', '--show-sdk-path'),
            'sdk_version': query('xcrun', '--sdk', 'macosx', '--show-sdk-version'),
            'sdk_build': query('xcrun', '--sdk', 'macosx', '--show-sdk-build-version'),
            'architecture': platform.machine()}


def identity(toolchain):
    return {'schema': SCHEMA, 'source_sha256': sha256(SOURCE), 'plist_sha256': sha256(PLIST),
            'toolchain': toolchain,
            'compile_flags': ['-sdk', toolchain['sdk'], '-target', toolchain['architecture'] + '-apple-macos26.0'],
            'sign_flags': ['--force', '--sign', '-']}


def validate_helper(binary, manifest_path):
    """Validate against this checkout and selected guest toolchain, never manifest-supplied inputs."""
    binary, manifest_path = Path(binary).resolve(), Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text())
    expected = identity(discover_toolchain())
    if manifest.get('identity') != expected or manifest.get('cache_key') != digest_json(expected):
        raise ValueError('Helper does not match current source/plist/toolchain')
    key = digest_json(expected)
    entry = manifest_path.parent
    if (manifest_path.name != 'manifest.json' or entry.name != key
            or binary != entry / 'AudioCapture.app/Contents/MacOS/pilot'):
        raise ValueError('Expected manifest beside its content-keyed bundle entry')
    if (manifest.get('binary_sha256') != sha256(binary)
            or manifest.get('bundle_plist_sha256') != sha256(binary.parent.parent / 'Info.plist')
            or manifest.get('bundle_plist_sha256') != expected['plist_sha256']):
        raise ValueError('Helper binary or bundle plist does not match provenance')
    if manifest.get('toolchain_sha256') != digest_json(expected['toolchain']):
        raise ValueError('Helper does not match current source/plist/toolchain')
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(binary.parent.parent.parent)],
                   check=True, timeout=30)
    return {'verified': True, 'binary': str(binary), 'manifest': str(manifest_path),
            'binary_sha256': sha256(binary), 'cache_key': key,
            'source_sha256': expected['source_sha256'], 'plist_sha256': expected['plist_sha256'],
            'toolchain_sha256': digest_json(expected['toolchain'])}


def build_helper(cache):
    cache = Path(cache).resolve()
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    toolchain = discover_toolchain()
    expected = identity(toolchain)
    key = digest_json(expected)
    destination = cache / key
    binary = destination / 'AudioCapture.app/Contents/MacOS/pilot'
    manifest_path = destination / 'manifest.json'
    # Keep the lock inode: replacing it could admit two builders for one key.
    with (cache / '.build.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if destination.exists():
            return validate_helper(binary, manifest_path)
        stage = Path(tempfile.mkdtemp(prefix='.' + key + '-', dir=cache))
        try:
            app = stage / 'AudioCapture.app'
            executable = app / 'Contents/MacOS/pilot'
            executable.parent.mkdir(parents=True)
            shutil.copyfile(PLIST, app / 'Contents/Info.plist')
            frozen_source = stage / 'audio-capture.swift'
            shutil.copyfile(SOURCE, frozen_source)
            if sha256(frozen_source) != expected['source_sha256'] or sha256(app / 'Contents/Info.plist') != expected['plist_sha256']:
                raise ValueError('Capture source/plist changed during build staging')
            command = [toolchain['compiler'], *expected['compile_flags'], str(frozen_source), '-o', str(executable)]
            with (stage / 'build.log').open('w') as log:
                subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=180)
                subprocess.run(['/usr/bin/codesign', *expected['sign_flags'], str(app)],
                               check=True, stdout=log, stderr=subprocess.STDOUT, timeout=30)
                subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(app)],
                               check=True, stdout=log, stderr=subprocess.STDOUT, timeout=30)
            manifest = {'identity': expected, 'cache_key': key, 'toolchain_sha256': digest_json(toolchain),
                        'binary_sha256': sha256(executable), 'bundle_plist_sha256': sha256(app / 'Contents/Info.plist'),
                        'build_command': command, 'sign_command': ['/usr/bin/codesign', *expected['sign_flags'], str(app)]}
            (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            os.rename(stage, destination)
        except BaseException:
            # Retain a failed build's log/source-keyed directory for inspection.
            (stage / 'failed').touch()
            raise
    return validate_helper(binary, manifest_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build', help='Build once per current source/plist/toolchain identity')
    build.add_argument('--cache', required=True, type=Path)
    verify = commands.add_parser('verify', help='Check a built entry against current checkout/toolchain')
    verify.add_argument('--binary', required=True, type=Path)
    verify.add_argument('--manifest', required=True, type=Path)
    args = parser.parse_args()
    result = build_helper(args.cache) if args.command == 'build' else validate_helper(args.binary, args.manifest)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
