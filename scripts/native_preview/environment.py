"""Read-only Xcode and simulator capability checks shared by preview and iOS CI."""
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess

MINIMUM_SDK = (27, 1)
DUO_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'


class Unavailable(RuntimeError):
    pass


def version(value):
    numbers = re.findall(r'\d+', value)
    return tuple(map(int, numbers[:2])) if len(numbers) >= 2 else (0, 0)


def command(*args, env=None):
    result = subprocess.run(list(map(str, args)), env=env, capture_output=True, text=True)
    if result.returncode:
        raise Unavailable((result.stderr or result.stdout).strip() or 'Command failed: ' + str(args[0]))
    return result.stdout


def developer_directory(explicit=None):
    if explicit:
        path = Path(explicit).expanduser().resolve()
        return path / 'Contents/Developer' if path.suffix == '.app' else path
    if os.environ.get('DEVELOPER_DIR'):
        return Path(os.environ['DEVELOPER_DIR']).expanduser().resolve()
    choices = []
    for app in Path('/Applications').glob('Xcode*.app'):
        try:
            with (app / 'Contents/Info.plist').open('rb') as stream:
                release = version(plistlib.load(stream)['CFBundleShortVersionString'])
            choices.append((release, str(app), app / 'Contents/Developer'))
        except (OSError, ValueError, KeyError):
            continue
    if choices:
        return max(choices)[2]
    return Path(command('xcode-select', '-p').strip())


def toolchain(explicit=None):
    developer = developer_directory(explicit)
    if not developer.is_dir():
        raise Unavailable('Xcode developer directory not found: ' + str(developer))
    env = dict(os.environ, DEVELOPER_DIR=str(developer))
    xcode = command('xcodebuild', '-version', env=env).strip()
    sdk = command('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version', env=env).strip()
    if version(sdk) < MINIMUM_SDK:
        raise Unavailable('iOS Simulator SDK 27.1+ is required; selected SDK is ' + sdk
                          + '. Select a newer Xcode with --xcode /Applications/Xcode_27.1.app.')
    for flag in ['-license', '-checkFirstLaunchStatus']:
        args = ['xcodebuild', flag] + (['check'] if flag == '-license' else [])
        result = subprocess.run(args, env=env, capture_output=True, text=True)
        if result.returncode:
            raise Unavailable('Xcode needs license/first-launch setup. Open this Xcode and complete setup: '
                              + str(developer.parent.parent))
    return {'developer': str(developer), 'xcode': xcode, 'simulator_sdk': sdk}, env


def simulator_inventory(env):
    return {kind: json.loads(command('xcrun', 'simctl', 'list', kind, '--json', env=env))[kind]
            for kind in ['runtimes', 'devices']}


def device_plan(inventory, kind):
    name = 'Arcadia Preview Duo' if kind == 'duo' else 'Arcadia Preview iPhone'
    runtimes = {r['identifier']: r for r in inventory['runtimes'] if r.get('isAvailable')}
    candidates = []
    for runtime, rows in inventory['devices'].items():
        minimum = (27, 1) if kind == 'duo' else (26, 0)
        if runtime not in runtimes or version(runtime) < minimum:
            continue
        for device in rows:
            if not device.get('isAvailable', True):
                continue
            device_type = device.get('deviceTypeIdentifier', '')
            legacy = 'Arcadia PR12 Duo' if kind == 'duo' else 'Arcadia PR12 iPhone'
            if (device['name'] in {name, legacy} and 'iPhone' in device_type
                    and ((kind == 'duo') == (device_type == DUO_TYPE))):
                candidates.append((version(runtime), runtime, device))
    if candidates:
        _, runtime, device = max(candidates, key=lambda item: item[0])
        return {'kind': kind, 'name': name, 'runtime': runtime, **device}
    if kind == 'duo':
        compatible = [r for r in runtimes.values() if version(r['identifier']) >= (27, 1)
                      and any(t['identifier'] == DUO_TYPE for t in r.get('supportedDeviceTypes', []))]
        if not compatible:
            raise Unavailable('Duo requires an installed iOS 27.1+ runtime supporting iPhone Duo. '
                              'Install it with: xcodebuild -downloadPlatform iOS -buildVersion 27.1')
        runtime = max(compatible, key=lambda r: version(r['identifier']))['identifier']
        device_type = DUO_TYPE
    else:
        phones = [(version(runtime), runtime, device) for runtime, rows in inventory['devices'].items()
                  if runtime in runtimes and version(runtime) >= (26, 0)
                  for device in rows if device.get('isAvailable', True)
                  and 'iPhone' in device.get('deviceTypeIdentifier', '')
                  and device.get('deviceTypeIdentifier') != DUO_TYPE]
        if not phones:
            raise Unavailable('An available iOS 26+ regular iPhone simulator is required.')
        _, runtime, template = max(phones, key=lambda item: (item[0], 'Pro' in item[2]['name']))
        device_type = template['deviceTypeIdentifier']
    return {'kind': kind, 'name': name, 'runtime': runtime, 'deviceTypeIdentifier': device_type,
            'state': 'not created'}


def boot_ready(result):
    return result.returncode == 0 and 'migration failed' not in (result.stdout + result.stderr).lower()
