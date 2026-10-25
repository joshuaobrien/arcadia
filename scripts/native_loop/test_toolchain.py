"""Run the real readiness CLI against controlled external tool executables."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ReadinessCommand(unittest.TestCase):
    def probe(self, missing=False, incompatible=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'Mintfile').write_text('realm/SwiftLint@0.65.1\n')
            (root / '.swift-format').write_text('{}')
            commands = root / 'bin'; commands.mkdir()
            for name in ['mint', 'xcodebuild', 'xcrun']:
                if missing and name == 'mint': continue
                path = commands / name
                path.write_text('#!' + sys.executable + '\n' + '''import sys
name=sys.argv[0].split('/')[-1]
if name=='mint':
 if '--version' in sys.argv: print('Version: 0.18.0')
 else:
  assert '--no-install' in sys.argv
  print('0.65.1')
elif name=='xcodebuild': print('Xcode 27.1\\nBuild version 27A9275')
elif '--configuration' in sys.argv: sys.exit(''' + ('1' if incompatible else '0') + ''')
else: print('main')
''')
                path.chmod(0o755)
            output = root / 'readiness.json'
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('toolchain.py')), str(root), str(output)],
                                    env=dict(os.environ, PATH=str(commands)), capture_output=True, text=True)
            return result, json.loads(output.read_text())

    def test_missing_mint_fails_without_installing_anything(self):
        result, report = self.probe(missing=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(report['ready'])
        self.assertIn('mint: missing', result.stdout)

    def test_incompatible_formatter_configuration_fails(self):
        result, report = self.probe(incompatible=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(any('formatter_configuration' in e for e in report['errors']))

    def test_prepared_toolchain_passes_and_records_versions(self):
        result, report = self.probe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(report['ready'])
        self.assertEqual(report['tools']['swiftlint'], '0.65.1')

class CertificateChecks(unittest.TestCase):
    def test_uncertified_or_changed_template_is_rejected(self):
        from toolchain import require_certificate
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'certificate.json'
            with self.assertRaisesRegex(RuntimeError, 'not certified'):
                require_certificate(path, 'image-a', 'config-a')
            path.write_text(json.dumps({'ready': True, 'image': 'image-a', 'contract_sha256': 'config-a'}))
            require_certificate(path, 'image-a', 'config-a')
            for image, config in [('image-b', 'config-a'), ('image-a', 'config-b')]:
                with self.assertRaisesRegex(RuntimeError, 'changed'):
                    require_certificate(path, image, config)

    def test_finished_task_can_be_loaded_for_certification_but_not_reused(self):
        import argparse
        import runner
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / 'smoke'; directory.mkdir()
            (directory / 'manifest.json').write_text(json.dumps({'owner': runner.OWNER, 'task': 'smoke', 'state': 'finished', 'vm': 'arcadia-loop-smoke-1234abcd'}))
            task = runner.Task(argparse.Namespace(root=temporary, task='smoke', operation='certify'))
            task.load()
            task.args.operation = 'build'
            with self.assertRaises(runner.LoopError): task.load()

    def test_certificate_cannot_be_published_before_smoke_checks_and_cleanup(self):
        import argparse
        import runner
        task = runner.Task(argparse.Namespace(root='/tmp/test-only', task='smoke'))
        for state, runs in [('ready', []), ('finished', [])]:
            task.manifest = {'template_name': 'candidate', 'state': state, 'runs': runs, 'source_sha256': 'source'}
            with self.assertRaises(runner.LoopError):
                task.certify_template()


class StartupCertificateCommand(unittest.TestCase):
    def test_uncertified_template_fails_before_any_vm_clone(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            template = root / '.tart/vms/candidate'
            template.mkdir(parents=True)
            for name in ['config.json', 'nvram.bin', 'disk.img']:
                (template / name).write_text('fixture')
            source = root / 'checkout'
            (source / 'Arcadia').mkdir(parents=True)
            for name in ['Mintfile', '.swift-format', '.swiftlint.yml']:
                (source / name).write_text('fixture')
            calls = root / 'calls.jsonl'
            provider = root / 'tart'
            provider.write_text('#!' + sys.executable + '\n' +
                'import sys,json,pathlib\n' +
                'with pathlib.Path(' + repr(str(calls)) + ').open("a") as f: f.write(json.dumps(sys.argv[1:])+"\\n")\n' +
                'print("[]" if sys.argv[1]=="list" else "fixture")\n')
            provider.chmod(0o755)
            env = dict(os.environ, HOME=str(root), TART_BIN=str(provider))
            env.pop('NATIVE_LOOP_HOST', None)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('runner.py')),
                '--root', str(root / 'tasks'), 'start', 'uncertified', '--source', str(source),
                '--template', 'candidate'], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('not certified', result.stdout + result.stderr)
            commands = [json.loads(line)[0] for line in calls.read_text().splitlines()]
            self.assertNotIn('clone', commands)
            self.assertNotIn('run', commands)


if __name__ == '__main__': unittest.main()
