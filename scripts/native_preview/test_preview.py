"""CLI contracts at the Xcode/simctl process boundary; never boots a real device."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import threading
import unittest

CLI = Path(__file__).resolve().parents[1] / 'native-preview'
FAKE_TOOL = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
a = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as log:
    log.write(json.dumps({'tool': name, 'args': a, 'mode': os.environ.get('SIMCTL_CHILD_ARCADIA_DATA_MODE')}) + '\n')
if name == 'xcodebuild':
    if '-version' in a:
        print('Xcode 27.1\nBuild version 27A9275')
    elif 'build' in a:
        cache = pathlib.Path(a[a.index('-derivedDataPath') + 1])
        mobile = 'generic/platform=iOS Simulator' in a
        (cache / 'Build/Products' / ('Debug-iphonesimulator' if mobile else 'Debug') / 'Arcadia.app').mkdir(parents=True)
elif name == 'ps':
    if os.environ.get('OLD_PID'):
        print(os.environ['OLD_PID'] + ' ' + os.environ['OLD_EXECUTABLE'])
elif name == 'xcrun':
    if '--show-sdk-version' in a:
        print(os.environ.get('SDK_VERSION', '27.1'))
    elif a[:2] == ['simctl', 'list']:
        facts = json.loads(pathlib.Path(os.environ['FACTS']).read_text())
        print(json.dumps({a[2]: facts[a[2]]}))
    elif a[:2] == ['simctl', 'bootstatus'] and os.environ.get('BAD_BOOT'):
        print('Status=3, isTerminal=YES\nData Migration Failed')
    elif a[:2] == ['simctl', 'create']:
        print('NEW-DEVICE')
    elif a[:2] == ['simctl', 'launch']:
        print('tokyo.drift.Arcadia.MobileReview: 1234')
'''


class PreviewCLI(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ['xcodebuild', 'xcrun', 'codesign', 'open', 'ps']:
            script = self.bin / name
            script.write_text(FAKE_TOOL.replace('#!/usr/bin/env python3', '#!' + sys.executable))
            script.chmod(0o755)
        self.xcode = self.root / 'Xcode.app'
        (self.xcode / 'Contents/Developer').mkdir(parents=True)
        (self.xcode / 'Contents/Applications/DeviceHub.app').mkdir(parents=True)
        self.calls = self.root / 'calls.jsonl'
        self.facts = self.root / 'facts.json'
        self.cache = self.root / 'cache'
        self.write_facts()
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        CALLS=str(self.calls), FACTS=str(self.facts))

    def write_facts(self, duo=True):
        phone = {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', 'isAvailable': True}
        fold = {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-27-1', 'isAvailable': True,
                'supportedDeviceTypes': [{'identifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'}]}
        devices = {phone['identifier']: [{'name': 'Arcadia PR12 iPhone', 'udid': 'EXISTING-PHONE', 'state': 'Shutdown',
                                        'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'}]}
        if duo:
            devices[fold['identifier']] = [{'name': 'Arcadia PR12 Duo', 'udid': 'EXISTING-DUO', 'state': 'Shutdown',
                                           'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'}]
        self.facts.write_text(json.dumps({'runtimes': [phone, fold] if duo else [phone], 'devices': devices}))

    def invoke(self, *args, **environment):
        return subprocess.run([sys.executable, str(CLI), '--xcode', str(self.xcode), '--cache', str(self.cache), *args],
                              env=dict(self.env, **environment), capture_output=True, text=True,
                              cwd=self.root, timeout=30)

    def recorded(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_read_only_check_reuses_phone_and_ignores_newer_duo(self):
        result = self.invoke('--device', 'iphone', '--check', '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        facts = json.loads(result.stdout)
        self.assertEqual(facts['devices'][0]['udid'], 'EXISTING-PHONE')
        self.assertEqual(facts['mode'], 'jellyfin')
        self.assertFalse(self.cache.exists())
        self.assertFalse(any(c['args'][:2] in [['simctl', 'create'], ['simctl', 'boot']]
                             or c['tool'] == 'open' or 'build' in c['args'] for c in self.recorded()))

    def test_sdk_26_is_rejected_before_build_even_if_xcode_label_is_new(self):
        result = self.invoke('--check', SDK_VERSION='26.6')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SDK 27.1+', result.stderr)
        self.assertIn('26.6', result.stderr)
        self.assertFalse(any('build' in c['args'] for c in self.recorded()))

    def test_duo_and_both_are_rejected_before_tools_run(self):
        for device in ['duo', 'both']:
            result = self.invoke('--device', device, '--check')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('invalid choice', result.stderr)
            self.assertFalse(self.calls.exists())

    def test_zero_exit_migration_failure_stops_before_install_or_launch(self):
        result = self.invoke('--device', 'iphone', BAD_BOOT='1')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('boot/migration failed', result.stderr)
        calls = self.recorded()
        self.assertTrue(any(c['args'][:2] == ['simctl', 'bootstatus'] for c in calls))
        self.assertFalse(any(c['args'][:2] in [['simctl', 'install'], ['simctl', 'launch']] for c in calls))

    def test_repeated_preview_replaces_owned_mac_process(self):
        old = subprocess.Popen(['sleep', '30'])
        waiter = threading.Thread(target=old.wait, daemon=True)
        waiter.start()
        self.addCleanup(lambda: old.kill() if old.poll() is None else None)
        executable = self.cache / 'mac/Build/Products/Debug/Arcadia.app/Contents/MacOS/Arcadia'
        result = self.invoke('--device', 'iphone', OLD_PID=str(old.pid), OLD_EXECUTABLE=str(executable.resolve()))
        self.assertEqual(result.returncode, 0, result.stderr)
        waiter.join(timeout=1)
        self.assertEqual(old.returncode, -15)
        self.assertTrue(any(c['tool'] == 'open' for c in self.recorded()))

    def test_success_uses_actual_checkout_and_real_jellyfin_on_owned_phone(self):
        result = self.invoke('--device', 'iphone')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.recorded()
        builds = [c for c in calls if c['tool'] == 'xcodebuild' and 'build' in c['args']]
        self.assertEqual(len(builds), 2)
        for build in builds:
            self.assertEqual(build['args'][build['args'].index('-project') + 1],
                             str(CLI.parents[1] / 'Arcadia/Arcadia.xcodeproj'))
        launch = next(c for c in calls if c['args'][:2] == ['simctl', 'launch'])
        self.assertIn('EXISTING-PHONE', launch['args'])
        self.assertEqual(launch['mode'], 'jellyfin')
        mac = next(c for c in calls if c['tool'] == 'open' and 'ARCADIA_DATA_MODE=jellyfin' in c['args'])
        self.assertIn('Arcadia.app', ' '.join(mac['args']))
        self.assertIn('-n', mac['args'])


if __name__ == '__main__':
    unittest.main()
