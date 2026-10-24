"""Host-only CI admission and disposable-worker lifecycle."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temporary, path)


def fingerprint(template):
    for name in ['config.json', 'disk.img', 'nvram.bin']:
        if not (template / name).is_file():
            raise RuntimeError('Provision an intact local template; missing ' + name)
    return {name: hashlib.sha256((template / name).read_bytes()).hexdigest()
            for name in ['config.json', 'manifest.json'] if (template / name).exists()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template', required=True)
    parser.add_argument('--template-root', type=Path, default=Path.home() / '.tart/vms')
    parser.add_argument('--state', type=Path, default=Path.home() / '.cache/arcadia-ci')
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--reserve-gib', type=float, default=float(os.environ.get('ARCADIA_CI_RESERVE_GIB', '12')))
    parser.add_argument('--max-guests', type=int, default=2)
    parser.add_argument('--provision', action='store_true')
    parser.add_argument('--command-timeout', type=float, default=2400)
    args, command = parser.parse_known_args(argv)
    if command[:1] == ['--']:
        command = command[1:]
    if not args.template or Path(args.template).name != args.template or args.template in {'.', '..'}:
        parser.error('template must name a local VM, not a registry image or path')
    template = args.template_root / args.template
    record = args.state / 'templates' / (args.template + '.json')
    report = {'template': args.template, 'passed': False, 'phases': [], 'worker_removed': False}
    child = None
    registered = False
    started = time.monotonic()
    lock = None
    status = 1
    previous = {}

    def phase(name):
        report['phases'].append({'phase': name, 'seconds': round(time.monotonic() - started, 3)})
        print('[ci] ' + name, flush=True)

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    try:
        if not template.is_dir():
            raise RuntimeError('Provision the local CI template before running: ' + args.template)
        if shutil.disk_usage(args.template_root).free < args.reserve_gib * 1024 ** 3:
            raise RuntimeError('Insufficient disk reserve; no worker created')
        identity = fingerprint(template)
        if args.provision:
            write_json(record, {'template': args.template, 'identity': identity})
            print('Provisioned local template identity: ' + args.template)
            return 0
        if not record.exists() or json.loads(record.read_text()).get('identity') != identity:
            raise RuntimeError('Provision/validate template identity before running: ' + args.template)
        if not command:
            raise RuntimeError('A worker command is required')
        args.state.mkdir(parents=True, exist_ok=True)
        lock = (args.state / 'worker.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('CI worker capacity occupied; retry through the CI queue')
        inventory = json.loads(subprocess.check_output(['tart', 'list', '--format', 'json'], text=True, timeout=15))
        if sum(str(v.get('State', v.get('state', ''))).lower() in {'running', 'suspended'} for v in inventory) >= args.max_guests:
            raise RuntimeError('Guest capacity occupied; no worker created')
        report.update({'vm': 'arcadia-fast-ci-' + uuid.uuid4().hex[:12], 'pid': os.getpid(),
                       'run_id': os.environ.get('GITHUB_RUN_ID'), 'identity': identity,
                       'free_before': shutil.disk_usage(args.template_root).free})
        ownership = args.state / 'workers' / (report['vm'] + '.json')
        write_json(ownership, report)
        registered = True
        for sig in [signal.SIGTERM, signal.SIGINT]:
            previous[sig] = signal.signal(sig, interrupted)
        phase('local clone')
        subprocess.run(['tart', 'clone', args.template, report['vm'], '--prune-limit', '0'],
                       env=dict(os.environ, TART_NO_AUTO_PRUNE='1'), check=True, timeout=120)
        phase('worker command')
        child = subprocess.Popen(command, env=dict(os.environ, ARCADIA_CI_VM=report['vm'],
                                                  ARCADIA_CI_MANAGED='1'), start_new_session=True)
        deadline = time.monotonic() + args.command_timeout
        while True:
            try:
                status = child.wait(timeout=15)
                break
            except subprocess.TimeoutExpired:
                print('[ci] worker command still running', flush=True)
                if time.monotonic() >= deadline:
                    raise RuntimeError('Worker command deadline exceeded')
        if status:
            raise RuntimeError('Worker command failed: ' + str(status))
    except KeyboardInterrupt:
        report['error'] = 'Cancelled'
        status = 130
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report['error'] = str(error)
        print(str(error), file=sys.stderr, flush=True)
        status = 1
    finally:
        if registered:
            # Finish bounded cleanup even if the runner sends another cancellation.
            for sig in previous:
                signal.signal(sig, signal.SIG_IGN)
            phase('cleanup')
            if child:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            cleanup = []
            for operation in ['stop', 'delete']:
                try:
                    result = subprocess.run(['tart', operation, report['vm']], capture_output=True,
                                            text=True, timeout=25)
                    if result.returncode:
                        # A partial clone may never have registered a VM. Verify absence below.
                        cleanup.append(operation + ': ' + result.stderr.strip())
                    if operation == 'delete':
                        report['worker_removed'] = result.returncode == 0
                except (OSError, subprocess.SubprocessError) as error:
                    cleanup.append(operation + ': ' + str(error))
            if child:
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
            report['cleanup_errors'] = cleanup
            if cleanup:
                status = 1
            report['passed'] = status == 0 and report['worker_removed']
            report['seconds'] = round(time.monotonic() - started, 3)
            report['free_after'] = shutil.disk_usage(args.template_root).free
            write_json(ownership, report)
        if not args.provision:
            write_json(args.artifacts / 'worker.json', report)
        if lock:
            lock.close()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return status
