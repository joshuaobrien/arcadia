"""Warm guest iteration; VM lifetime and evidence export belong to native-loop."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

ROOT = Path('/tmp/arcadia-loop')
WORKSPACE = ROOT / 'source'
EXCHANGE = Path('/Volumes/My Shared Files/artifacts')


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def command(*args, timeout=120, env=None):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True, timeout=timeout, env=env)
    if result.returncode:
        # UI/server content and launch environment never enter diagnostic messages.
        raise RuntimeError(f'{Path(str(args[0])).name} {args[1] if len(args) > 1 else ""} failed ({result.returncode})')
    return result.stdout.strip()


def sync_source(archive):
    if digest(archive) != os.environ['ARCADIA_SOURCE_SHA256']:
        raise RuntimeError('Source archive fingerprint changed')
    with tempfile.TemporaryDirectory(dir=ROOT, prefix='iteration-source-') as temporary:
        staged = Path(temporary).resolve()
        with tarfile.open(archive) as bundle:
            for entry in bundle:
                path = (staged / entry.name).resolve()
                if not path.is_relative_to(staged) or not (entry.isdir() or entry.isfile()):
                    raise RuntimeError('Unsafe source archive')
        command('/usr/bin/tar', '-xzf', archive, '-C', staged)
        # Content comparison preserves unchanged input mtimes and catches same-size
        # edits within one second; stock macOS rsync -a cannot guarantee either.
        for path in sorted(WORKSPACE.rglob('*'), reverse=True):
            relative = path.relative_to(WORKSPACE)
            if not (staged / relative).exists():
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                else:
                    path.unlink()
        for path in staged.rglob('*'):
            destination = WORKSPACE / path.relative_to(staged)
            if destination.is_symlink() or (destination.exists() and destination.is_dir() != path.is_dir()):
                if destination.is_dir() and not destination.is_symlink():
                    shutil.rmtree(destination)
                else:
                    destination.unlink()
            if path.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            elif not destination.is_file() or digest(path) != digest(destination):
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)


def prepare_device(platform, state):
    inventory = json.loads(command('xcrun', 'simctl', 'list', 'runtimes', '--json'))['runtimes']
    device_type = 'com.apple.CoreSimulator.SimDeviceType.' + ('iPhone-Duo' if platform == 'duo' else 'iPhone-17')
    supported = [r for r in inventory if r.get('isAvailable') and any(
        t['identifier'] == device_type for t in r.get('supportedDeviceTypes', []))]
    if not supported:
        raise RuntimeError(f'No installed runtime for {platform}; use the Xcode27.1 task template')
    runtime = max(supported, key=lambda r: tuple(map(int, r['version'].split('.'))))['identifier']
    key = platform + ':' + runtime
    if key not in state:
        state[key] = command('xcrun', 'simctl', 'create', 'Arcadia task ' + platform, device_type, runtime)
        (ROOT / 'iteration-devices.json').write_text(json.dumps(state))
    device = state[key]
    devices = json.loads(command('xcrun', 'simctl', 'list', 'devices', '--json'))['devices']
    actual = next((d for rows in devices.values() for d in rows if d['udid'] == device), None)
    if actual is None:
        raise RuntimeError('Task simulator disappeared; finish this task and start a fresh one')
    if actual['state'] != 'Booted':
        command('xcrun', 'simctl', 'boot', device)
        command('xcrun', 'simctl', 'bootstatus', device, '-b', timeout=180)
    # bootstatus success alone did not guarantee a live device in the experiment.
    devices = json.loads(command('xcrun', 'simctl', 'list', 'devices', '--json'))['devices']
    if not any(d['udid'] == device and d['state'] == 'Booted' for rows in devices.values() for d in rows):
        raise RuntimeError('Task simulator did not remain booted; no screenshot accepted')
    return device


def capture(helper, pids, output, marker):
    deadline = time.monotonic() + 30
    attempt = output.with_name('capture-attempt.png')
    while time.monotonic() < deadline:
        for pid in pids():
            windows = json.loads(command(helper, 'windows', str(pid)))
            for window in windows:
                result = subprocess.run(['/usr/sbin/screencapture', '-x', '-o', '-l', str(window), str(attempt)],
                                        capture_output=True, timeout=10)
                if result.returncode or not attempt.exists():
                    continue
                result = subprocess.run([str(helper), 'inspect', str(attempt), marker],
                                        capture_output=True, text=True, timeout=20)
                if result.returncode == 0 and json.loads(result.stdout)['matched']:
                    attempt.replace(output)
                    return
        time.sleep(.2)
    raise RuntimeError('No visible frame with this run marker; stale/black images rejected')


def main():
    task, run_id, platform, screen, mode, scenario = sys.argv[1:]
    if platform not in {'mac', 'iphone', 'duo'} or screen not in {'songs', 'artists', 'albums', 'playlists', 'search'}:
        raise RuntimeError('Invalid iteration platform/screen')
    ROOT.mkdir(exist_ok=True)
    WORKSPACE.mkdir(exist_ok=True)
    output = EXCHANGE / run_id
    output.mkdir(exist_ok=True)
    record = {'captured': False, 'run_id': run_id, 'source_sha256': os.environ['ARCADIA_SOURCE_SHA256'],
              'platform': platform, 'state': screen, 'data_mode': mode, 'scenario': scenario,
              'behavior_verified': False, 'phases': []}
    started = time.monotonic()
    def phase(name):
        record['phases'].append({'name': name, 'seconds': round(time.monotonic() - started, 3)})
        print('[native-loop] ' + name, flush=True)
    try:
        phase('source synchronization')
        sync_source(Path(os.environ['ARCADIA_SOURCE_ARCHIVE']))
        helper_source = Path(__file__).with_name('frame.swift')
        helper = ROOT / ('frame-' + digest(helper_source)[:16])
        if not helper.exists():
            phase('capture helper setup (once per driver)')
            command('xcrun', 'swiftc', helper_source, '-o', helper, timeout=180)
        device = None
        if platform != 'mac':
            phase('task simulator readiness')
            state_path = ROOT / 'iteration-devices.json'
            device = prepare_device(platform, json.loads(state_path.read_text()) if state_path.exists() else {})
            record['simulator'] = device
        phase('incremental ' + platform + ' build')
        derived = ROOT / ('iteration-' + ('mac' if platform == 'mac' else 'ios'))
        identity = 'tokyo.drift.Arcadia.Iteration.' + ('Mac' if platform == 'mac' else 'Mobile')
        args = ['xcodebuild', '-project', str(WORKSPACE / 'Arcadia/Arcadia.xcodeproj'),
                '-scheme', 'Arcadia' if platform == 'mac' else 'ArcadiaMobile', '-configuration', 'Debug',
                '-destination', 'platform=macOS' if device is None else 'platform=iOS Simulator,id=' + device,
                '-derivedDataPath', str(derived), '-skipMacroValidation', 'CODE_SIGN_IDENTITY=-',
                'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=', 'PRODUCT_BUNDLE_IDENTIFIER=' + identity, 'build']
        # Keep the incremental build log separate from image verification.
        build = subprocess.Popen([sys.executable, str(Path(__file__).with_name('progress.py')),
                                  str(output / 'build.log'), *args], start_new_session=True)
        try:
            if build.wait(timeout=1800):
                raise RuntimeError('Build failed; inspect build.log')
        except BaseException:
            try:
                os.killpg(build.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            raise
        phase('launch selected state')
        product = derived / 'Build/Products' / ('Debug' if device is None else 'Debug-iphonesimulator') / 'Arcadia.app'
        command('/usr/bin/codesign', '--verify', '--deep', '--strict', product)
        namespace = 'iteration-' + task
        env = dict(os.environ, ARCADIA_DATA_MODE=mode, ARCADIA_FIXTURE_SCENARIO=scenario,
                   ARCADIA_SESSION_NAMESPACE=namespace, ARCADIA_LIBRARY_NAMESPACE=namespace,
                   ARCADIA_VISUAL_RUN_ID=run_id, ARCADIA_RUN_ID=run_id)
        launch_args = ['-arcadia.library.destination.' + namespace, screen,
                       '-arcadia.library.last-category.' + namespace, screen if screen != 'search' else 'songs',
                       '-ApplePersistenceIgnoreState', 'YES']
        if device is None:
            executable = str(product / 'Contents/MacOS/Arcadia')
            for row in command('/bin/ps', '-axo', 'pid=,comm=').splitlines():
                parts = row.strip().split(None, 1)
                if len(parts) == 2 and parts[1] == executable:
                    os.kill(int(parts[0]), signal.SIGTERM)
            log = (output / 'app.log').open('w')
            process = subprocess.Popen([executable, *launch_args], env=env, stdout=log, stderr=log, start_new_session=True)
            record['pid'] = process.pid
            pids = lambda: [process.pid] if process.poll() is None else []
        else:
            command('xcrun', 'simctl', 'install', device, product)
            child = dict(os.environ, **{'SIMCTL_CHILD_' + k: v for k, v in env.items() if k in {'ARCADIA_DATA_MODE', 'ARCADIA_FIXTURE_SCENARIO', 'ARCADIA_SESSION_NAMESPACE',
                        'ARCADIA_LIBRARY_NAMESPACE', 'ARCADIA_VISUAL_RUN_ID', 'ARCADIA_RUN_ID'}})
            command('xcrun', 'simctl', 'launch', '--terminate-running-process', device, identity, *launch_args, env=child)
            developer = Path(os.environ.get('DEVELOPER_DIR') or command('xcode-select', '-p'))
            viewer = developer.parent / 'Applications/DeviceHub.app'
            if not viewer.exists():
                viewer = developer / 'Applications/Simulator.app'
            command('/usr/bin/open', '-a', viewer, '--args', '-CurrentDeviceUDID', device)
            name = viewer.stem
            def pids():
                result = subprocess.run(['/usr/bin/pgrep', '-x', name], capture_output=True, text=True)
                return [int(p) for p in result.stdout.split()]
        phase('capture current frame')
        marker = 'FRAME' + run_id[-8:].upper()
        image = output / 'screenshot.png'
        capture(helper, pids, image, marker)
        record.update(captured=True, image_sha256=digest(image), marker=marker)
        phase('fresh image verified')
    finally:
        record['seconds'] = round(time.monotonic() - started, 3)
        (output / 'verification.json').write_text(json.dumps(record, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('native-loop iterate: ' + str(error), file=sys.stderr)
        sys.exit(1)
