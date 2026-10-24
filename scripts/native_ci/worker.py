"""Host-only CI admission and disposable-worker lifecycle."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import selectors
import subprocess
import sys
import time
import tempfile
import uuid
import urllib.request


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(temporary, path)


def fingerprint(template):
    for name in ['config.json', 'disk.img', 'nvram.bin']:
        if not (template / name).is_file():
            raise RuntimeError('Provision an intact local template; missing ' + name)
    identity = {name: hashlib.sha256((template / name).read_bytes()).hexdigest()
                for name in ['config.json', 'manifest.json', 'nvram.bin'] if (template / name).exists()}
    # Detect writes/replacement without reading an entire 87 GiB disk on every job.
    disk = (template / 'disk.img').stat()
    identity['disk'] = {'bytes': disk.st_size, 'modified_ns': disk.st_mtime_ns,
                        'inode': disk.st_ino, 'device': disk.st_dev}
    return identity


def valid_seed(seed):
    receipt = seed.with_suffix('.json')
    try:
        return (seed.stat().st_size <= 512 * 1024 ** 2 and
                json.loads(receipt.read_text()).get('sha256') == hashlib.sha256(seed.read_bytes()).hexdigest())
    except (OSError, ValueError):
        return False


def inventory():
    return json.loads(subprocess.check_output(['tart', 'list', '--format', 'json'], text=True, timeout=15))


def resource_budget(template, root, guests):
    if sys.platform == 'darwin':
        memory = int(subprocess.check_output(['/usr/sbin/sysctl', '-n', 'hw.memsize'], text=True, timeout=5))
    else:
        memory = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    cpus = os.cpu_count() or 1
    configurations = [json.loads((template / 'config.json').read_text())]
    for guest in guests:
        if str(guest.get('State', guest.get('state', ''))).lower() in {'running', 'suspended'}:
            name = guest.get('Name', guest.get('name', ''))
            if not name or Path(name).name != name:
                raise RuntimeError('Cannot determine active guest resource budget')
            configurations.append(json.loads((root / name / 'config.json').read_text()))
    if any(int(c.get('memorySize', 0)) <= 0 or int(c.get('cpuCount', 0)) <= 0 for c in configurations):
        raise RuntimeError('Cannot determine guest CPU/memory budgets')
    requested_memory = sum(int(c['memorySize']) for c in configurations)
    requested_cpus = sum(int(c['cpuCount']) for c in configurations)
    if requested_memory + max(4 * 1024 ** 3, memory // 4) > memory:
        raise RuntimeError('Insufficient host memory headroom for guest budgets')
    if requested_cpus > cpus:
        raise RuntimeError('Guest CPU budgets exceed host CPU capacity')
    return {'host_memory_bytes': memory, 'host_cpus': cpus,
            'admitted_guest_memory_bytes': requested_memory, 'admitted_guest_cpus': requested_cpus}


def remove_worker(vm):
    attempts = []
    try:
        if not any(v.get('Name', v.get('name')) == vm for v in inventory()):
            return True, attempts
        for operation in ['stop', 'delete']:
            try:
                result = subprocess.run(['tart', operation, vm], capture_output=True, text=True, timeout=25)
                if result.returncode:
                    attempts.append(operation + ': ' + result.stderr.strip())
            except (OSError, subprocess.SubprocessError) as error:
                attempts.append(operation + ': ' + str(error))
        absent = not any(v.get('Name', v.get('name')) == vm for v in inventory())
        return absent, attempts
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        attempts.append('Cannot verify worker absence: ' + str(error))
        return False, attempts


def owned_group_members(group):
    output = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,uid=,stat='], text=True, timeout=5)
    members = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 4 and int(fields[1]) == group and int(fields[2]) == os.getuid() and not fields[3].startswith('Z'):
            members.append(int(fields[0]))
    return members


def stop_owned_processes(child):
    # Tart can put a privileged vmnet helper in this group. Signal only our UID;
    # stopping the owned VM below releases its system helper through Tart itself.
    for sig in [signal.SIGTERM, signal.SIGKILL]:
        for pid in owned_group_members(child.pid):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
    child.wait(timeout=5)
    deadline = time.monotonic() + 3
    while owned_group_members(child.pid):
        if time.monotonic() >= deadline:
            raise RuntimeError('Owned process group has surviving processes')
        time.sleep(.05)


def reconcile(state):
    outcomes = []
    for path in sorted((state / 'workers').glob('*.json')):
        owned = json.loads(path.read_text())
        if owned.get('worker_removed'):
            continue
        vm = owned.get('vm', '')
        if not vm.startswith('arcadia-fast-ci-') or path.name != vm + '.json':
            raise RuntimeError('Invalid worker ownership record')
        try:
            os.kill(int(owned['pid']), 0)
            continue
        except ProcessLookupError:
            pass
        token = os.environ.get('ARCADIA_CI_TOKEN')
        repository = os.environ.get('GITHUB_REPOSITORY')
        api_url = os.environ.get('GITHUB_API_URL')
        if not (token and repository and api_url and owned.get('run_id') and owned.get('repository') == repository):
            raise RuntimeError('Orphan needs authoritative CI run verification before cleanup: ' + vm)
        url = api_url.rstrip('/') + '/repos/' + repository + '/actions/runs/' + str(owned['run_id'])
        request = urllib.request.Request(url, headers={'Authorization': 'token ' + token})
        with urllib.request.urlopen(request, timeout=10) as response:
            run = json.load(response)
        if run.get('status') != 'completed':
            raise RuntimeError('Recorded worker still belongs to an active CI run: ' + vm)
        absent, attempts = remove_worker(vm)
        owned.update(worker_removed=absent, reconciliation_attempt_errors=attempts)
        write_json(path, owned)
        outcomes.append({'vm': vm, 'removed': absent})
        if not absent:
            raise RuntimeError('Orphan cleanup failed: ' + vm)
    return outcomes


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template', required=True)
    parser.add_argument('--template-root', type=Path, default=Path(os.environ.get('ARCADIA_CI_TEMPLATE_ROOT', str(Path.home() / '.tart/vms'))))
    parser.add_argument('--state', type=Path, default=Path(os.environ.get('ARCADIA_CI_STATE', str(Path.home() / '.cache/arcadia-ci'))))
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--reserve-gib', type=float, default=float(os.environ.get('ARCADIA_CI_RESERVE_GIB', '12')))
    parser.add_argument('--max-guests', type=int, default=2)
    parser.add_argument('--provision', action='store_true')
    parser.add_argument('--reconcile', action='store_true')
    parser.add_argument('--source', type=Path, default=Path.cwd())
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
    cache_private = None
    cache_entry = None

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
        if not command and not args.reconcile:
            raise RuntimeError('A worker command is required')
        args.state.mkdir(parents=True, exist_ok=True)
        lock = (args.state / 'worker.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('CI worker capacity occupied; retry through the CI queue')
        report['reconciled'] = reconcile(args.state)
        if args.reconcile:
            report.update(passed=True, scope='reconciliation')
            return 0
        guests = inventory()
        if sum(str(v.get('State', v.get('state', ''))).lower() in {'running', 'suspended'} for v in guests) >= args.max_guests:
            raise RuntimeError('Guest capacity occupied; no worker created')
        report['resources'] = resource_budget(template, args.template_root, guests)
        report.update({'vm': 'arcadia-fast-ci-' + uuid.uuid4().hex[:12], 'pid': os.getpid(),
                       'run_id': os.environ.get('GITHUB_RUN_ID'), 'repository': os.environ.get('GITHUB_REPOSITORY'), 'identity': identity,
                       'free_before': shutil.disk_usage(args.template_root).free})
        ownership = args.state / 'workers' / (report['vm'] + '.json')
        write_json(ownership, report)
        registered = True
        for sig in [signal.SIGTERM, signal.SIGINT]:
            previous[sig] = signal.signal(sig, interrupted)
        phase('local clone')
        subprocess.run(['tart', 'clone', args.template, report['vm'], '--prune-limit', '0'],
                       env=dict(os.environ, TART_NO_AUTO_PRUNE='1'), check=True, timeout=120)
        # Existing guest cache code strips app/test outputs; only dependency seeds cross jobs.
        inputs = [b'ci-dependencies-v1', json.dumps(identity, sort_keys=True).encode()]
        for path in sorted((args.source / 'Arcadia').rglob('Package.resolved')):
            inputs.append(path.read_bytes())
        project = args.source / 'Arcadia/Arcadia.xcodeproj/project.pbxproj'
        if project.is_file():
            inputs.append(project.read_bytes())
        for relative in ['scripts/native_ci/build_cache.py', 'scripts/native_loop/dependencies.py',
                         'scripts/ci-native.sh', 'scripts/native_ios/guest.py',
                         'scripts/native_preview/environment.py']:
            helper = args.source / relative
            if helper.is_file():
                inputs.append(helper.read_bytes())
        key = hashlib.sha256(b'\0'.join(inputs)).hexdigest()
        cache_entry = args.state / 'dependencies' / key
        cache_private = Path(tempfile.mkdtemp(prefix='dependencies-', dir=args.state))
        if cache_entry.is_dir():
            for seed in cache_entry.glob('*.tgz'):
                receipt = seed.with_suffix('.json')
                if valid_seed(seed):
                    shutil.copy2(seed, cache_private / seed.name)
                    shutil.copy2(receipt, cache_private / receipt.name)
        report['dependency_key'] = key
        phase('worker command')
        args.artifacts.mkdir(parents=True, exist_ok=True)
        child = subprocess.Popen(command, env=dict(os.environ, ARCADIA_CI_VM=report['vm'],
                                                  ARCADIA_CI_MANAGED='1', ARCADIA_CI_EVIDENCE_DIR=str(args.artifacts.resolve()),
                                                  ARCADIA_CI_CACHE_DIR=str(cache_private)), start_new_session=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + args.command_timeout
        last_progress = time.monotonic()
        with selectors.DefaultSelector() as reader, (args.artifacts / 'worker.log').open('wb') as log:
            reader.register(child.stdout, selectors.EVENT_READ)
            pending = b''
            logged = 0
            while reader.get_map() or child.poll() is None:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Worker command deadline exceeded')
                for key_event, _ in reader.select(timeout=min(1, max(.01, deadline - time.monotonic()))):
                    chunk = os.read(key_event.fd, 65536)
                    if not chunk:
                        reader.unregister(child.stdout)
                        continue
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                    if logged < 64 * 1024 ** 2:
                        log.write(chunk[:64 * 1024 ** 2 - logged])
                        logged += len(chunk)
                    pending += chunk
                    lines = pending.split(b'\n')
                    pending = lines.pop()[-65536:]
                    for line in lines:
                        text = line.decode(errors='replace').strip()
                        if text.startswith('==>'):
                            phase(text.removeprefix('==>').strip())
                if time.monotonic() - last_progress >= 15:
                    print('[ci] worker command still running', flush=True)
                    last_progress = time.monotonic()
        status = child.wait(timeout=5)
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
            process_errors = []
            if child:
                try:
                    stop_owned_processes(child)
                except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                    process_errors.append(str(error))
                finally:
                    if child.stdout:
                        child.stdout.close()
            absent, attempts = remove_worker(report['vm'])
            report['worker_removed'] = absent
            report['cleanup_attempt_errors'] = attempts
            cleanup = process_errors + ([] if absent else ['Owned VM still present or absence unverified'])
            report['template_unchanged'] = fingerprint(template) == identity
            if not report['template_unchanged']:
                cleanup.append('Golden template identity changed')
            report['cleanup_errors'] = cleanup
            if cleanup:
                status = 1
            if status == 0 and not cleanup:
                try:
                    phase('cache publication')
                    cache_entry.mkdir(parents=True, exist_ok=True)
                    for seed in cache_private.glob('*.tgz'):
                        receipt = seed.with_suffix('.json')
                        if valid_seed(seed):
                            generation = cache_entry / ('.' + seed.stem + '-' + uuid.uuid4().hex)
                            generation.mkdir()
                            shutil.copy2(seed, generation / seed.name)
                            shutil.copy2(receipt, generation / receipt.name)
                            os.replace(generation / seed.name, cache_entry / seed.name)
                            os.replace(generation / receipt.name, cache_entry / receipt.name)
                            generation.rmdir()
                except (OSError, ValueError) as error:
                    report['error'] = 'Cache publication failed: ' + str(error)
                    status = 1
            report['passed'] = status == 0 and report['worker_removed']
            report['seconds'] = round(time.monotonic() - started, 3)
            report['free_after'] = shutil.disk_usage(args.template_root).free
            write_json(ownership, report)
            manifest = args.artifacts / 'manifest.json'
            if manifest.is_file():
                inner = json.loads(manifest.read_text())
                inner.update(vm_removed=report['worker_removed'], cleanup_errors=cleanup,
                             passed=inner.get('passed', False) and report['passed'])
                write_json(manifest, inner)
        if not args.provision:
            write_json(args.artifacts / 'worker.json', report)
        if cache_private:
            shutil.rmtree(cache_private)
        if lock:
            lock.close()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return status
