"""Exercise the public iteration command with a controlled external VM provider."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class IterationCommand(unittest.TestCase):
    def run_command(self, bad_run=False, bad_source=False, bad_image=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'checkout'
            (source / 'Arcadia').mkdir(parents=True)
            (source / 'Arcadia/View.swift').write_text('shared view')
            for name in ['Mintfile', '.swiftlint.yml', '.swift-format']:
                (source / name).write_text('fixture')
            task = root / 'tasks/example'
            (task / 'artifacts').mkdir(parents=True)
            (task / 'source').mkdir()
            (task / 'manifest.json').write_text(json.dumps({
                'owner': 'arcadia-native-loop-v1', 'task': 'example',
                'vm': 'arcadia-loop-example-1234abcd', 'state': 'ready',
                'image': 'fixture@sha256:abc', 'runs': []}))
            provider = root / 'tart'
            provider.write_text('''#!/usr/bin/env python3
import hashlib,json,os,pathlib,sys
args=sys.argv[1:];root=pathlib.Path(os.environ['FAKE_TASK'])
assert args[0]=='exec',args
operation=args[args.index('guest.sh')+1] if 'guest.sh' in args else None
# The immutable driver lives beneath the task's mounted tools directory.
index=next(i for i,a in enumerate(args) if a.endswith('/guest.sh'))
assert args[index+1]=='iterate',args
run=args[index+3];output=root/'artifacts'/run;output.mkdir()
source=next(a.split('=',1)[1] for a in args if a.startswith('ARCADIA_SOURCE_SHA256='))
image=b'controlled provider image';(output/'screenshot.png').write_bytes(image)
(output/'verification.json').write_text(json.dumps({'captured':True,'run_id':'old-run' if os.environ.get('BAD_RUN') else run,'source_sha256':'old-source' if os.environ.get('BAD_SOURCE') else source,'image_sha256':'wrong' if os.environ.get('BAD_IMAGE') else hashlib.sha256(image).hexdigest()}))
''')
            provider.chmod(0o755)
            env = dict(os.environ, TART_BIN=str(provider), FAKE_TASK=str(task))
            if bad_run:
                env['BAD_RUN'] = '1'
            if bad_source:
                env['BAD_SOURCE'] = '1'
            if bad_image:
                env['BAD_IMAGE'] = '1'
            command = [sys.executable, str(Path(__file__).with_name('runner.py')),
                       '--root', str(root / 'tasks'), 'iterate', 'example',
                       '--source', str(source), '--platform', 'mac', '--state', 'albums']
            result = subprocess.run(command, env=env, capture_output=True, text=True)
            return result, json.loads((task / 'manifest.json').read_text())

    def test_iteration_records_current_source_and_captured_image_without_tests(self):
        result, manifest = self.run_command()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        run = next(r for r in manifest['runs'] if r['operation'] == 'iterate')
        self.assertEqual(run['operation'], 'iterate')
        self.assertEqual(run['status'], 'passed')
        self.assertEqual(run['source_sha256'], manifest['source_sha256'])
        self.assertNotIn('tests', run)

    def test_previous_run_image_is_rejected(self):
        result, manifest = self.run_command(True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(next(r for r in manifest['runs'] if r['operation'] == 'iterate')['status'], 'failed')

    def test_wrong_source_is_rejected(self):
        result, manifest = self.run_command(bad_source=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(manifest['runs'][-1]['status'], 'failed')

    def test_modified_image_is_rejected(self):
        result, manifest = self.run_command(bad_image=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(manifest['runs'][-1]['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
