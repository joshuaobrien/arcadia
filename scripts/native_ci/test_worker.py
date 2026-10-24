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
store = pathlib.Path(os.environ['CALLS']).with_name('vms.json')
vms = json.loads(store.read_text()) if store.exists() else []
if sys.argv[1] == 'list': print(json.dumps(vms))
if sys.argv[1] == 'clone':
    vms.append({'Name': sys.argv[3], 'State': 'stopped'})
    store.write_text(json.dumps(vms))
    if os.environ.get('PAUSE_CLONE'): __import__('time').sleep(60)
if sys.argv[1] == 'stop' and os.environ.get('FAIL_STOP'): sys.exit(9)
if sys.argv[1] == 'delete':
    if os.environ.get('FAIL_DELETE'): sys.exit(9)
    store.write_text(json.dumps([v for v in vms if v['Name'] != sys.argv[2]]))
''')
        tart.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'], CALLS=str(self.calls))

    def invoke(self, *arguments, command=None):
        return subprocess.run([sys.executable, str(CLI), '--template', 'gold',
                               '--template-root', str(self.templates), '--state', str(self.root / 'state'),
                               '--artifacts', str(self.root / 'evidence'), *arguments,
                               '--', sys.executable, '-c', command or 'print("built current source")'],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def test_missing_local_template_fails_without_cloning_or_downloading(self):
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Provision', result.stderr)
        calls = self.calls.read_text() if self.calls.exists() else ''
        self.assertNotIn('clone', calls)
        self.assertNotIn('pull', calls)

    def test_low_disk_refuses_before_clone_and_retains_template(self):
        template = self.provision()
        result = self.invoke('--reserve-gib', '100000000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('disk', result.stderr.lower())
        self.assertTrue(template.exists())
        self.assertFalse(self.calls.exists())

    def provision(self):
        template = self.templates / 'gold'
        template.mkdir()
        for name in ['config.json', 'disk.img', 'nvram.bin']:
            (template / name).write_text(json.dumps({'memorySize': 1, 'cpuCount': 1}) if name == 'config.json' else '{}')
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
        durable = self.root / 'state/evidence' / receipt['vm']
        __import__('shutil').rmtree(self.root / 'evidence')
        self.assertIn('built current source', (durable / 'worker.log').read_text())
        self.assertTrue(json.loads((durable / 'worker.json').read_text())['passed'])
        self.assertFalse((self.root / 'state/private' / receipt['vm']).exists())
        self.assertEqual([c[1] for c in calls if c[0] == 'delete'], [receipt['vm']])

    def test_host_diagnostics_rotate_only_owned_history(self):
        self.provision()
        unknown = self.root / 'state/evidence/arcadia-fast-ci-unowned'
        unknown.mkdir(parents=True)
        (unknown / 'keep').write_text('unrelated evidence')
        for _ in range(6):
            result = self.invoke('--reserve-gib', '0')
            self.assertEqual(result.returncode, 0, result.stderr)
        history = list((self.root / 'state/evidence').glob('*/worker.json'))
        self.assertLessEqual(len(history), 5)
        self.assertEqual((unknown / 'keep').read_text(), 'unrelated evidence')

    def test_changed_template_requires_explicit_reprovisioning(self):
        template = self.provision()
        (template / 'config.json').write_text('{"changed": true}')
        result = self.invoke('--reserve-gib', '0')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('identity', result.stderr)
        self.assertFalse(self.calls.exists())

    def test_changed_template_disk_requires_reprovisioning_even_with_same_config(self):
        template = self.provision()
        (template / 'disk.img').write_text('updated SDK bytes')
        result = self.invoke('--reserve-gib', '0')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('identity', result.stderr)

    def test_template_exceeding_host_memory_is_refused_before_clone(self):
        template = self.provision()
        (template / 'config.json').write_text(json.dumps({'memorySize': 10 ** 18, 'cpuCount': 4}))
        self.assertEqual(self.invoke('--provision').returncode, 0)
        result = self.invoke('--reserve-gib', '0')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('memory', result.stderr.lower())
        self.assertFalse(self.calls.exists() and 'clone' in self.calls.read_text())

    def test_cleanup_failure_cannot_be_reported_as_success(self):
        self.provision()
        self.env['FAIL_DELETE'] = '1'
        result = self.invoke('--reserve-gib', '0')
        self.assertNotEqual(result.returncode, 0)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertFalse(receipt['passed'])
        self.assertTrue(receipt['cleanup_errors'])
        self.assertTrue((self.root / 'state/private' / receipt['vm']).exists())

    def test_failed_cleanup_does_not_publish_dependency_seed(self):
        self.provision()
        self.env['FAIL_DELETE'] = '1'
        command = """import hashlib, json, os
from pathlib import Path
seed = Path(os.environ['ARCADIA_CI_CACHE_DIR']) / 'debug.tgz'
seed.write_bytes(b'new dependency seed')
seed.with_suffix('.json').write_text(json.dumps({'sha256': hashlib.sha256(seed.read_bytes()).hexdigest()}))
"""
        result = self.invoke('--reserve-gib', '0', command=command)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list((self.root / 'state/dependencies').glob('**/*.tgz')))

    def test_private_cleanup_failure_cannot_publish_seed_or_claim_success(self):
        self.provision()
        command = """import hashlib, json, os
from pathlib import Path
private = Path(os.environ['ARCADIA_CI_PRIVATE_DIR'])
seed = Path(os.environ['ARCADIA_CI_CACHE_DIR']) / 'debug.tgz'
seed.write_bytes(b'new dependency seed')
seed.with_suffix('.json').write_text(json.dumps({'sha256': hashlib.sha256(seed.read_bytes()).hexdigest()}))
held = private.with_name(private.name + '-held')
private.rename(held)
private.symlink_to(held, target_is_directory=True)
"""
        result = self.invoke('--reserve-gib', '0', command=command)
        self.assertNotEqual(result.returncode, 0)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertTrue(receipt['worker_removed'])
        self.assertFalse(receipt['private_removed'])
        self.assertFalse(receipt['passed'])
        self.assertIn('Private input cleanup', str(receipt['cleanup_errors']))
        self.assertFalse(list((self.root / 'state/dependencies').glob('**/*.tgz')))

    def test_successful_delete_recovers_from_stop_error_without_poisoning_next_job(self):
        self.provision()
        self.env['FAIL_STOP'] = '1'
        result = self.invoke('--reserve-gib', '0')
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertTrue(receipt['worker_removed'])
        self.assertTrue(receipt['cleanup_attempt_errors'])
        self.assertEqual(self.invoke('--reserve-gib', '0').returncode, 0)

    def test_changed_cache_inputs_invalidate_seed_and_current_source_runs(self):
        self.provision()
        source = self.root / 'source'
        project = source / 'Arcadia/Arcadia.xcodeproj/project.pbxproj'
        project.parent.mkdir(parents=True)
        project.write_text('initial build settings')
        current = source / 'current.py'
        current.write_text('print("initial current source")')
        command = 'exec(open(' + repr(str(current)) + ').read())'
        first = self.invoke('--reserve-gib', '0', '--source', str(source), command=command)
        self.assertEqual(first.returncode, 0, first.stderr)
        initial = json.loads((self.root / 'evidence/worker.json').read_text())['dependency_key']
        project.write_text('changed build settings')
        current.write_text('print("changed current source")')
        second = self.invoke('--reserve-gib', '0', '--source', str(source), command=command)
        self.assertEqual(second.returncode, 0, second.stderr)
        changed = json.loads((self.root / 'evidence/worker.json').read_text())['dependency_key']
        self.assertNotEqual(initial, changed)
        self.assertIn('changed current source', second.stdout)

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
        receipt.update(pid=99999999, run_id='7', repository='jj/arcadia', worker_removed=True)
        owned = self.root / 'state/workers' / (receipt['vm'] + '.json')
        owned.write_text(json.dumps(receipt))
        private = self.root / 'state/private' / receipt['vm']
        private.mkdir(parents=True)
        (private / 'source-fixture').write_text('private input')

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
            # Recovery must remain available when a crashed worker consumed the reserve.
            result = self.invoke('--reserve-gib', '100000000', '--reconcile')
            server.shutdown()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(owned.read_text())['worker_removed'])
        self.assertFalse(private.exists())
        self.assertTrue(json.loads((self.root / 'evidence/worker.json').read_text())['passed'])

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

    def test_cancelled_partial_clone_is_removed_and_next_job_can_run(self):
        self.provision()
        self.env['PAUSE_CLONE'] = '1'
        process = subprocess.Popen([sys.executable, str(CLI), '--template', 'gold',
                                   '--template-root', str(self.templates), '--state', str(self.root / 'state'),
                                   '--artifacts', str(self.root / 'evidence'), '--reserve-gib', '0',
                                   '--', sys.executable, '-c', 'print("should not start")'],
                                  env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        deadline = time.monotonic() + 3
        while not (self.root / 'vms.json').exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue((self.root / 'vms.json').exists())
        process.terminate()
        output, error = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 130, output + error)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertTrue(receipt['worker_removed'])
        self.assertNotIn('should not start', output)
        del self.env['PAUSE_CLONE']
        self.assertEqual(self.invoke('--reserve-gib', '0').returncode, 0)

    def test_command_deadline_fails_and_releases_next_job(self):
        self.provision()
        result = self.invoke('--reserve-gib', '0', '--command-timeout', '.1',
                             command='import time; print("diagnostic retained", flush=True); time.sleep(60)')
        self.assertNotEqual(result.returncode, 0)
        receipt = json.loads((self.root / 'evidence/worker.json').read_text())
        self.assertIn('deadline', receipt['error'])
        self.assertTrue(receipt['worker_removed'])
        self.assertIn('diagnostic retained', (self.root / 'evidence/worker.log').read_text())
        self.assertEqual(self.invoke('--reserve-gib', '0').returncode, 0)

    def test_cancellation_stops_descendant_that_ignores_termination(self):
        self.provision()
        heartbeat = self.root / 'descendant-heartbeat'
        descendant = ('import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                      f'p=pathlib.Path({str(heartbeat)!r}); '
                      'exec("while True:\\n p.write_text(str(time.time()))\\n time.sleep(.02)")')
        leader = ('import subprocess,sys,time; '
                  f'subprocess.Popen([sys.executable,"-c",{descendant!r}]); time.sleep(60)')
        process = subprocess.Popen([sys.executable, str(CLI), '--template', 'gold',
                                   '--template-root', str(self.templates), '--state', str(self.root / 'state'),
                                   '--artifacts', str(self.root / 'evidence'), '--reserve-gib', '0',
                                   '--', sys.executable, '-c', leader], env=self.env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        deadline = time.monotonic() + 3
        while not heartbeat.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(heartbeat.exists())
        process.terminate()
        process.communicate(timeout=5)
        self.assertEqual(process.returncode, 130)
        last = heartbeat.read_text()
        time.sleep(.1)
        self.assertEqual(heartbeat.read_text(), last)


if __name__ == '__main__':
    unittest.main()
