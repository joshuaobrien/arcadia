"""CI contracts at the public process/VM boundary; no real VM is started."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

CLI = Path(__file__).resolve().parents[1] / 'ci-worker'


class WorkerCommand(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.templates = self.root / 'templates'
        self.templates.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.calls = self.root / 'calls'
        tart = self.bin / 'tart'
        tart.write_text('#!' + sys.executable + '''
import json, os, pathlib, sys
with open(os.environ['CALLS'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1] == 'list': print('[]')
if sys.argv[1] == 'delete' and os.environ.get('FAIL_DELETE'): sys.exit(9)
''')
        tart.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'], CALLS=str(self.calls))

    def invoke(self, *arguments):
        return subprocess.run([sys.executable, str(CLI), '--template', 'gold',
                               '--template-root', str(self.templates), '--state', str(self.root / 'state'),
                               '--artifacts', str(self.root / 'evidence'), *arguments,
                               '--', sys.executable, '-c', 'print("built current source")'],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def test_missing_local_template_fails_without_cloning_or_downloading(self):
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Provision', result.stderr)
        calls = self.calls.read_text() if self.calls.exists() else ''
        self.assertNotIn('clone', calls)
        self.assertNotIn('pull', calls)

    def test_low_disk_refuses_before_clone_and_retains_template(self):
        template = self.templates / 'gold'
        template.mkdir()
        result = self.invoke('--reserve-gib', '100000000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('disk', result.stderr.lower())
        self.assertTrue(template.exists())
        self.assertFalse(self.calls.exists())

    def provision(self):
        template = self.templates / 'gold'
        template.mkdir()
        for name in ['config.json', 'disk.img', 'nvram.bin']:
            (template / name).write_text('{}')
        result = self.invoke('--provision')
        self.assertEqual(result.returncode, 0, result.stderr)
        return template

    def test_warm_local_worker_runs_current_command_and_removes_only_owned_clone(self):
        template = self.provision()
        result = self.invoke('--reserve-gib', '0')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('built current source', result.stdout)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        clone = next(c for c in calls if c[0] == 'clone')
        self.assertEqual(clone[1], 'gold')
        self.assertIn('--prune-limit', clone)
        self.assertNotIn('pull', [c[0] for c in calls])
        self.assertTrue(template.exists())
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertTrue(receipt['passed'])
        self.assertTrue(receipt['worker_removed'])
        self.assertEqual([c[1] for c in calls if c[0] == 'delete'], [receipt['vm']])

    def test_changed_template_requires_explicit_reprovisioning(self):
        template = self.provision()
        (template / 'config.json').write_text('{"changed": true}')
        result = self.invoke('--reserve-gib', '0')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('identity', result.stderr)
        self.assertFalse(self.calls.exists())

    def test_cleanup_failure_cannot_be_reported_as_success(self):
        self.provision()
        self.env['FAIL_DELETE'] = '1'
        result = self.invoke('--reserve-gib', '0')
        self.assertNotEqual(result.returncode, 0)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertFalse(receipt['passed'])
        self.assertTrue(receipt['cleanup_errors'])

    def test_corrupt_dependency_metadata_falls_back_to_current_build(self):
        self.provision()
        self.assertEqual(self.invoke('--reserve-gib', '0').returncode, 0)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        entry = self.root / 'state/dependencies' / receipt['dependency_key']
        entry.mkdir(exist_ok=True)
        (entry / 'debug.tgz').write_bytes(b'broken')
        (entry / 'debug.json').write_text('invalid json')
        result = self.invoke('--reserve-gib', '0')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('built current source', result.stdout)

    def test_restart_reclaims_orphan_only_after_server_confirms_run_completed(self):
        self.provision()
        self.assertEqual(self.invoke('--reserve-gib', '0').returncode, 0)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        receipt.update(pid=99999999, run_id='7', repository='jj/arcadia', worker_removed=False)
        owned = self.root / 'state/workers' / (receipt['vm'] + '.json')
        owned.write_text(json.dumps(receipt))

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"id":7,"status":"completed"}')

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.env.update(GITHUB_API_URL='http://127.0.0.1:' + str(server.server_port),
                            GITHUB_REPOSITORY='jj/arcadia', ARCADIA_CI_TOKEN='test')
            result = self.invoke('--reserve-gib', '0', '--reconcile')
            server.shutdown()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(owned.read_text())['worker_removed'])

    def test_cancellation_releases_only_owned_worker_and_preserves_evidence(self):
        self.provision()
        process = subprocess.Popen([sys.executable, str(CLI), '--template', 'gold',
                                   '--template-root', str(self.templates), '--state', str(self.root / 'state'),
                                   '--artifacts', str(self.root / 'evidence'), '--reserve-gib', '0',
                                   '--', sys.executable, '-c', 'import time; time.sleep(60)'],
                                  env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if self.calls.exists() and 'clone' in self.calls.read_text():
                break
            time.sleep(.02)
        process.terminate()
        output, error = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 130, output + error)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertEqual(receipt['error'], 'Cancelled')
        self.assertTrue(receipt['worker_removed'])


if __name__ == '__main__':
    unittest.main()
