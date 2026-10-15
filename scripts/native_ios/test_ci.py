"""Exercise the host CLI against a fake VM provider, without starting a VM."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class CompilationLane(unittest.TestCase):
    def run_lane(self, fail):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            provider = root / 'tart'
            provider.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys, time
args = sys.argv[1:]
root = pathlib.Path(os.environ['FAKE_ROOT'])
with (root / 'calls').open('a') as log:
    log.write(json.dumps(args) + '\\n')
if args[0] == 'run':
    shared = next(arg for arg in args if arg.startswith('--dir=artifacts:'))
    (root / 'artifacts').write_text(shared.split(':', 1)[1])
    time.sleep(30)
elif args[0] == 'exec' and '--archive' in args:
    if os.environ['FAIL_GUEST'] == '1':
        sys.exit(7)
    artifacts = pathlib.Path((root / 'artifacts').read_text())
    sha = args[args.index('--sha') + 1]
    (artifacts / 'verification.json').write_text(json.dumps({'passed': True, 'source_sha256': sha}))
''')
            provider.chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       FAKE_ROOT=str(root), FAIL_GUEST=str(int(fail)))
            result = subprocess.run([str(ROOT / 'scripts/ci-native-ios'), '--artifacts', str(root / 'evidence')],
                                    env=env, capture_output=True, text=True, timeout=40)
            report = json.loads((root / 'evidence/manifest.json').read_text())
            calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
            self.assertTrue(report['vm_removed'])
            self.assertEqual([call[0] for call in calls if call[0] in {'clone', 'stop', 'delete'}],
                             ['clone', 'stop', 'delete'])
            self.assertTrue(all(call[-1] == report['vm'] for call in calls if call[0] in {'stop', 'delete'}))
            return result, report

    def test_success_requires_guest_verdict_and_removes_owned_vm(self):
        result, report = self.run_lane(False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(report['passed'])
        self.assertEqual(len(report['source_sha256']), 64)

    def test_guest_failure_still_removes_owned_vm_and_retains_manifest(self):
        result, report = self.run_lane(True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(report['passed'])
        self.assertIn('error', report)


if __name__ == '__main__':
    unittest.main()
