"""Interactive local review, deliberately separate from the isolated development loop."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

from native_preview.environment import (Unavailable, boot_ready, command, device_plan,
                                        simulator_inventory, toolchain)

REPOSITORY = Path(__file__).resolve().parents[2]
IDENTIFIERS = {'mac': 'tokyo.drift.Arcadia.Review', 'mobile': 'tokyo.drift.Arcadia.MobileReview'}
# Preserve sessions from the original PR12 preview while isolating production data.
PREVIEW_ENV = {'ARCADIA_DATA_MODE': 'jellyfin', 'ARCADIA_SESSION_NAMESPACE': 'pr12-review',
               'ARCADIA_LIBRARY_NAMESPACE': 'pr12-review'}


def build(repository, cache, target, env):
    mobile = target == 'mobile'
    log = cache / (target + '.log')
    args = ['xcodebuild', '-project', str(repository / 'Arcadia/Arcadia.xcodeproj'),
            '-scheme', 'ArcadiaMobile' if mobile else 'Arcadia', '-configuration', 'Debug',
            '-destination', 'generic/platform=iOS Simulator' if mobile else 'platform=macOS',
            '-derivedDataPath', str(cache / target), '-skipMacroValidation',
            'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=',
            'PRODUCT_BUNDLE_IDENTIFIER=' + IDENTIFIERS[target], 'build']
    print('Building ' + target + ' preview…', flush=True)
    process = subprocess.Popen([sys.executable, str(repository / 'scripts/native_loop/progress.py'),
                                str(log), *args], env=env, start_new_session=True)
    try:
        status = process.wait(timeout=1800)
    except BaseException:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise
    if status:
        lines = log.read_text(errors='replace').splitlines()
        errors = [line for line in lines if 'error:' in line]
        raise Unavailable('\n'.join(errors or lines[-20:]) + '\nFull build log: ' + str(log))
    product = cache / target / 'Build/Products' / ('Debug-iphonesimulator' if mobile else 'Debug') / 'Arcadia.app'
    if not product.is_dir():
        raise Unavailable('Build produced no app: ' + str(product))
    command('codesign', '--verify', '--deep', '--strict', product, env=env)
    return product


def launch_phone(plan, product, cache, env):
    if 'udid' not in plan:
        plan['udid'] = command('xcrun', 'simctl', 'create', plan['name'],
                               plan['deviceTypeIdentifier'], plan['runtime'], env=env).strip()
    udid = plan['udid']
    if plan['state'] != 'Booted':
        command('xcrun', 'simctl', 'boot', udid, env=env)
    print('Waiting for ' + plan['name'] + '…', flush=True)
    boot = subprocess.run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], env=env,
                          capture_output=True, text=True, timeout=180)
    log = cache / (plan['kind'] + '-boot.log')
    log.write_text(boot.stdout + boot.stderr)
    if not boot_ready(boot):
        raise Unavailable('Simulator boot/migration failed; app was not installed. Log: ' + str(log))
    command('xcrun', 'simctl', 'install', udid, product, env=env)
    child = dict(env, **{'SIMCTL_CHILD_' + key: value for key, value in PREVIEW_ENV.items()})
    command('xcrun', 'simctl', 'launch', '--terminate-running-process', udid,
            IDENTIFIERS['mobile'], env=child)
    developer = Path(env['DEVELOPER_DIR'])
    viewers = [developer.parent / 'Applications/DeviceHub.app', developer / 'Applications/Simulator.app']
    viewer = next((path for path in viewers if path.is_dir()), None)
    if viewer is None:
        raise Unavailable('No simulator viewer found in the selected Xcode.')
    command('open', '-a', viewer, '--args', '-CurrentDeviceUDID', udid, env=env)
    print('Opened ' + plan['name'] + ' in Jellyfin mode.', flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', choices=['iphone', 'duo', 'both'], default='iphone',
                        help='Mobile preview alongside the Mac app (default: iphone).')
    parser.add_argument('--xcode', help='Xcode.app or Contents/Developer directory; system selection is unchanged.')
    parser.add_argument('--check', action='store_true', help='Read-only toolchain/runtime check; no builds or devices created.')
    parser.add_argument('--json', action='store_true', help='Print --check results as JSON.')
    parser.add_argument('--cache', type=Path, help='Override the persistent build/log cache.')
    args = parser.parse_args(argv)
    if args.json and not args.check:
        parser.error('--json requires --check')
    try:
        facts, env = toolchain(args.xcode)
        inventory = simulator_inventory(env)
        kinds = ['iphone', 'duo'] if args.device == 'both' else [args.device]
        plans = [device_plan(inventory, kind) for kind in kinds]
        key = hashlib.sha256(str(REPOSITORY).encode()).hexdigest()[:12]
        cache = (args.cache or Path.home() / 'Library/Caches/Arcadia/native-preview' / key).expanduser().resolve()
        facts.update({'repository': str(REPOSITORY), 'cache': str(cache), 'mode': 'jellyfin', 'devices': plans})
        if args.check:
            print(json.dumps(facts, indent=2) if args.json else
                  'Ready: SDK ' + facts['simulator_sdk'] + '; ' + ', '.join(p['name'] for p in plans)
                  + '\nXcode: ' + facts['developer'] + '\nCache/logs: ' + str(cache))
            return 0
        cache.mkdir(parents=True, exist_ok=True)
        with (cache / 'preview.lock').open('w') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Unavailable('Another preview build is running for this checkout.')
            (cache / 'environment.json').write_text(json.dumps(facts, indent=2) + '\n')
            mac = build(REPOSITORY, cache, 'mac', env)
            command('open', '-a', mac, *[value for key, item in PREVIEW_ENV.items()
                                        for value in ['--env', key + '=' + item]], env=env)
            phone = build(REPOSITORY, cache, 'mobile', env)
            for plan in plans:
                launch_phone(plan, phone, cache, env)
            (cache / 'environment.json').write_text(json.dumps(facts, indent=2) + '\n')
        print('Ready. Sign in to Jellyfin in each preview. Logs: ' + str(cache))
        return 0
    except (Unavailable, OSError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Preview cancelled; logs retained.', file=sys.stderr)
        return 130
