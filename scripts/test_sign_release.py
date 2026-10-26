"""Signing command contracts with fake tools: no keychain/trust mutation on the test host."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = '75E8FFD5ED95862F752087ABD9B0EADF054147F4'


class SigningCommand(unittest.TestCase):
    def run_signing(self, model='VirtualMac2,1', failure=''):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = root / 'Arcadia.app'; (app / 'Contents').mkdir(parents=True)
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'tokyo.drift.Arcadia'}))
            config = root / 'signing.json'
            config.write_text(json.dumps({'identity': IDENTITY, 'pkcs12': 'dGVzdC1vbmx5', 'password': 'test-only-password'}))
            tools = root / 'tools'; tools.mkdir()
            controller = tools / 'fake-tool'
            controller.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
name=Path(sys.argv[0]).name
args=sys.argv[1:]
# Store operation and temporary paths only, never import passwords.
with open(os.environ['TEST_LOG'],'a') as f:f.write(json.dumps({'tool':name,'op':args[0] if args else '', 'temp':next((a for a in args if 'arcadia-release-signing-' in a),'')})+'\\n')
if name=='sysctl':print(os.environ['TEST_MODEL'])
if name=='security':
 if args[0]=='list-keychains' and '-s' not in args:print('"/tmp/original-test-keychain"')
 if args[0]=='list-keychains' and '-s' in args and len(args)==5 and os.environ['TEST_FAILURE']=='restore':sys.exit(1)
 if args[0]=='create-keychain':Path(args[-1]).touch()
 if args[0]=='import' and os.environ['TEST_FAILURE']=='import':
  print('test-only-password',file=sys.stderr);sys.exit(1)
if name=='codesign' and os.environ['TEST_FAILURE']=='codesign':sys.exit(1)
''')
            controller.chmod(0o700)
            for name in ['sysctl', 'security', 'sudo', 'codesign']:(tools / name).symlink_to(controller)
            log = root / 'calls.jsonl'
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'], ARCADIA_SIGNING_FILE=str(config), TEST_LOG=str(log), TEST_MODEL=model, TEST_FAILURE=failure)
            result = subprocess.run([sys.executable, str(ROOT / 'Arcadia/sign-release.py'), str(app)],env=env,text=True,capture_output=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            for call in calls:
                if call['temp']:
                    self.assertFalse(Path(call['temp']).exists(), 'Private signing material must be removed on success or failure')
            self.assertNotIn('test-only-password',result.stdout+result.stderr)
            return result,calls

    def test_physical_host_refused_before_keychain_or_trust_access(self):
        result,calls=self.run_signing(model='Mac15,3')
        self.assertEqual(result.returncode,1)
        self.assertIn('restricted to disposable VMs',result.stderr)
        self.assertEqual([c['tool'] for c in calls],['sysctl'])

    def test_import_failure_is_redacted_and_private_keychain_removed(self):
        result,calls=self.run_signing(failure='import')
        self.assertEqual(result.returncode,1)
        self.assertIn('Import signing identity failed',result.stderr)
        self.assertTrue(any(c['op']=='delete-keychain' for c in calls))
        self.assertFalse(any(c['tool']=='sudo' for c in calls))

    def test_signing_failure_restores_search_list_and_removes_private_material(self):
        result,calls=self.run_signing(failure='codesign')
        self.assertEqual(result.returncode,1)
        self.assertEqual(calls[-1]['op'],'delete-keychain')
        self.assertEqual(calls[-2]['op'],'list-keychains')

    def test_restore_failure_still_attempts_private_keychain_removal(self):
        result,calls=self.run_signing(failure='restore')
        self.assertEqual(result.returncode,1)
        self.assertIn('Restore keychain search list failed',result.stderr)
        self.assertEqual(calls[-1]['op'],'delete-keychain')

    def test_success_verifies_signature_and_removes_private_material(self):
        result,calls=self.run_signing()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('stable private identity',result.stdout)
        self.assertTrue(any(c['tool']=='codesign' and c['op']=='--verify' for c in calls))
        self.assertEqual(calls[-1]['op'],'delete-keychain')
