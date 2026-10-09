#!/usr/bin/env python3
"""Task-owned Tart execution. No third-party Python dependencies or host app execution."""
import argparse
import fcntl
import hashlib
import gzip
import json
import ipaddress
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

IMAGE = 'ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:61f6e857a3d65dd2f8daf9c51c7b837fa458bcc9181ae8556e645b534dab6bf6'
TOOLS = Path(__file__).resolve().parent
OWNER = 'arcadia-native-loop-v1'
TASK_PATTERN = r'[a-z0-9][a-z0-9-]{0,39}'


class LoopError(RuntimeError):
    pass


def run(command, *, timeout=180, **kwargs):
    try:
        return subprocess.run(command, check=True, timeout=timeout, **kwargs)
    except subprocess.TimeoutExpired as error:
        raise LoopError(f'Prerequisite/operation timed out after {timeout}s: {command[0]}') from error
    except subprocess.CalledProcessError as error:
        raise LoopError(f'Operation failed (exit {error.returncode}): {command[0]}') from error


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def mint_cache_key(image, mintfile):
    return hashlib.sha256(image.encode() + b'\0' + mintfile).hexdigest()[:24]


def publish_mint_cache(source, target):
    """Publish a completed private cache; guests never mutate the persistent seed."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with (target.parent / (target.name + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.exists():
            return
        with tempfile.TemporaryDirectory(dir=target.parent, prefix='.mint-') as temporary:
            staged = Path(temporary) / 'cache'
            shutil.copytree(source, staged, symlinks=True)
            staged.rename(target)


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def snapshot(source, output):
    """Only explicit native sources/config; never .git, xcuserdata or runtime secrets."""
    with output.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as archive:
        for name in ['Arcadia', '.swiftlint.yml', '.swift-format', 'Mintfile']:
            path = source / name
            if not path.exists():
                raise LoopError(f'Missing source prerequisite: {path}')
            def include(info):
                if any(part in {'xcuserdata', '.DS_Store', '.build', 'DerivedData'} for part in Path(info.name).parts):
                    return None
                if info.issym() or info.islnk():
                    raise LoopError(f'Source snapshot cannot contain links: {info.name}')
                # Stable metadata makes fingerprints independent of archive creation time.
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                return info
            archive.add(path, arcname=name, filter=include)


def source_revision(source):
    result = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else 'unversioned'


def available_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def validate_task(task):
    if not re.fullmatch(TASK_PATTERN, task):
        raise LoopError('Task must contain 1–40 lowercase letters, digits or hyphens; begin with a letter/digit')


def owned_manifest(directory):
    if directory.is_symlink():
        raise LoopError('Task directory must not be a symlink')
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('owner') != OWNER or manifest.get('task') != directory.name:
        raise LoopError('Refusing operation on resources not owned by this task')
    if not re.fullmatch(r'arcadia-loop-' + re.escape(directory.name) + r'-[0-9a-f]{8}', manifest.get('vm', '')):
        raise LoopError('Invalid task VM ownership')
    return manifest


class Task:
    def __init__(self, args):
        self.args = args
        self.directory = Path(args.root).resolve() / args.task
        self.path = self.directory / 'manifest.json'
        self.manifest = None
        self.tart = shutil.which('tart') or '/opt/homebrew/bin/tart'

    def sync_tools(self):
        target = self.directory / 'tools'
        target.mkdir(exist_ok=True)
        for path in TOOLS.iterdir():
            if path.is_file() and path.suffix in {'.py', '.sh'}:
                shutil.copyfile(path, target / path.name)
        guest = TOOLS / 'guest.sh'
        immutable_guest = target / f'guest-{fingerprint(guest)}.sh'
        if not immutable_guest.exists():
            shutil.copyfile(guest, immutable_guest)

    def save(self):
        atomic_json(self.path, self.manifest)

    def load(self):
        self.manifest = owned_manifest(self.directory)
        if self.manifest.get('state') == 'finished' and self.args.operation not in {'export', 'status', 'finish'}:
            raise LoopError('Task is finished; start a new task name for a fresh VM')

    def guest(self, operation, *arguments, timeout=2400):
        run_id = f'{self.args.task}-{operation}-{uuid.uuid4().hex[:8]}'
        started = time.monotonic()
        self.manifest['runs'].append({'id': run_id, 'operation': operation, 'source_sha256': self.manifest.get('source_sha256'),
                                      'driver_sha256': fingerprint(TOOLS / 'guest.sh'), 'status': 'running'})
        self.save()
        try:
            guest_name = f'guest-{fingerprint(TOOLS / "guest.sh")}.sh'
            archive_name = 'source-' + self.manifest['source_sha256'] + '.tgz'
            run([self.tart, 'exec', self.manifest['vm'], '/usr/bin/env',
                 'ARCADIA_SOURCE_ARCHIVE=/Volumes/My Shared Files/source/' + archive_name, '/bin/bash',
                 '/Volumes/My Shared Files/tools/' + guest_name, operation, self.args.task, run_id, *arguments], timeout=timeout)
        except Exception:
            self.manifest['runs'][-1]['status'] = 'failed'
            raise
        else:
            self.manifest['runs'][-1]['status'] = 'passed'
        finally:
            self.manifest['runs'][-1]['seconds'] = round(time.monotonic() - started, 2)
            self.save()
            print(json.dumps(self.manifest['runs'][-1]), flush=True)

    def sync_snapshot(self):
        target = self.directory / 'source/source.tgz'
        if self.args.snapshot:
            shutil.copyfile(self.args.snapshot, target)
        else:
            snapshot(Path(self.args.source).resolve(), target)
        self.manifest['source_sha256'] = fingerprint(target)
        immutable_archive = target.with_name('source-' + self.manifest['source_sha256'] + '.tgz')
        if not immutable_archive.exists():
            shutil.copyfile(target, immutable_archive)
        self.manifest['source_revision'] = self.args.revision or source_revision(Path(self.args.source).resolve())
        self.save()

    def start(self):
        if self.directory.exists():
            raise LoopError('Task name already exists; choose a fresh name')
        self.directory.mkdir(parents=True, mode=0o700)
        (self.directory / 'artifacts').mkdir(parents=True)
        (self.directory / 'source').mkdir()
        (self.directory / 'mint').mkdir()
        self.sync_tools()
        self.manifest = {'owner': OWNER, 'task': self.args.task, 'vm': f'arcadia-loop-{self.args.task}-{uuid.uuid4().hex[:8]}',
                         'image': self.args.image, 'state': 'starting', 'runs': [], 'created': time.time()}
        self.save()
        try:
            if '@sha256:' not in self.args.image:
                raise LoopError('TART_IMAGE must be pinned by digest')
            version = run([self.tart, '--version'], capture_output=True, text=True).stdout.strip()
            self.manifest['tart_version'] = version
            self.sync_snapshot()
            with tarfile.open(self.directory / 'source/source.tgz') as archive:
                mintfile = archive.extractfile('Mintfile').read()
            cache_root = Path(self.args.mint_seed).expanduser() if self.args.mint_seed else Path.home() / '.cache/arcadia-ci-mint'
            self.manifest['mint_cache_root'] = str(cache_root)
            cache = cache_root / 'native-loop' / mint_cache_key(self.args.image, mintfile)
            self.manifest['mint_cache'] = str(cache)
            seed = cache if cache.is_dir() else cache_root
            # Import the old CI cache once; never copy keyed caches recursively.
            if (seed / 'packages').is_dir():
                for name in ['packages', 'bin']:
                    if (seed / name).is_dir():
                        shutil.copytree(seed / name, self.directory / 'mint' / name, symlinks=True)
            self.save()
            run([self.tart, 'clone', self.args.image, self.manifest['vm']], timeout=900)
            with (self.directory / 'vm.log').open('w') as log:
                process = subprocess.Popen([self.tart, 'run', '--no-graphics', '--no-audio', '--no-clipboard',
                    '--dir=source:' + str(self.directory / 'source') + ':ro', '--dir=artifacts:' + str(self.directory / 'artifacts'), '--dir=tools:' + str(self.directory / 'tools') + ':ro',
                    '--dir=mint:' + str(self.directory / 'mint'), self.manifest['vm']],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            self.manifest['vm_pid'] = process.pid
            self.save()
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                try:
                    probe = subprocess.run([self.tart, 'exec', self.manifest['vm'], '/usr/bin/true'], capture_output=True, timeout=10)
                    if probe.returncode == 0:
                        break
                except subprocess.TimeoutExpired:
                    pass
                time.sleep(2)
            else:
                raise LoopError('Tart guest agent did not become ready within 180s')
            self.guest('preflight', timeout=60)
            self.manifest['state'] = 'ready'
            self.save()
            self.export()
        except Exception:
            self.manifest['state'] = 'start-failed'
            self.save()
            # Even failed startup must not leave a running clone.
            subprocess.run([self.tart, 'stop', self.manifest['vm']], capture_output=True, timeout=30)
            subprocess.run([self.tart, 'delete', self.manifest['vm']], capture_output=True, timeout=60)
            self.export()
            raise

    def export(self):
        if self.manifest.get('state') == 'ready':
            try:
                self.guest('export', timeout=180)
            except LoopError as error:
                # Preserve raw results and diagnostics even if Xcode cannot read an incomplete bundle.
                print(f'Attachment export warning: {error}', file=sys.stderr)
        self.save()
        review_archive = self.directory / 'review.tgz'
        temporary_review = self.directory / 'review.tmp.tgz'
        def review_files(info):
            if any(part.endswith('.xcresult') for part in Path(info.name).parts) or info.name.endswith('.mp4'):
                return None
            return info
        with tarfile.open(temporary_review, 'w:gz') as output:
            output.add(self.directory / 'artifacts', arcname='artifacts', filter=review_files)
            output.add(self.path, arcname='manifest.json')
        temporary_review.replace(review_archive)
        self.manifest['review_sha256'] = fingerprint(review_archive)
        self.save()
        if self.args.operation not in {'export', 'finish'}:
            print(f'Review evidence: {review_archive} sha256={self.manifest["review_sha256"]}', flush=True)
            return
        archive = self.directory / 'evidence.tgz'
        temporary_archive = self.directory / 'evidence.tmp.tgz'
        with tarfile.open(temporary_archive, 'w:gz') as output:
            output.add(self.directory / 'artifacts', arcname='artifacts')
            output.add(self.path, arcname='manifest.json')
            if (self.directory / 'vm.log').exists():
                output.add(self.directory / 'vm.log', arcname='vm.log')
        temporary_archive.replace(archive)
        # Verify local archive before permitting cleanup; remote wrapper verifies again after transfer.
        with tarfile.open(archive) as check:
            for entry in check.getmembers():
                if entry.isfile():
                    with check.extractfile(entry) as content:
                        while content.read(1024 * 1024):
                            pass
        self.manifest['export_sha256'] = fingerprint(archive)
        self.save()
        print(f'Evidence: {archive} sha256={self.manifest["export_sha256"]}', flush=True)

    def destroy_vm(self):
        inventory = json.loads(run([self.tart, 'list', '--format', 'json'], capture_output=True, text=True).stdout)
        entry = next((item for item in inventory if item['Name'] == self.manifest['vm'] and item['Source'] == 'local'), None)
        if entry:
            if entry['Running']:
                run([self.tart, 'stop', self.manifest['vm']], timeout=30)
            run([self.tart, 'delete', self.manifest['vm']], timeout=60)

    def finish(self):
        if self.manifest['state'] == 'finished':
            return
        self.export()
        if self.manifest.get('integration'):
            from integration import stop
            if self.manifest['integration'].get('project') != self.manifest['vm']:
                raise LoopError('Integration project does not belong to this task VM')
            stop(self.directory, self.manifest['integration'])
            state = self.directory / 'integration/test-environment/state'
            if state.exists():
                run(['docker', 'run', '--rm', '-v', str(state) + ':/state', 'alpine:3.21',
                     'chown', '-R', f'{os.getuid()}:{os.getgid()}', '/state'], timeout=180)
            shutil.rmtree(self.directory / 'integration')
            for name in ['integration-key', 'integration-key.pub', 'integration-known-hosts']:
                (self.directory / name).unlink(missing_ok=True)
        self.destroy_vm()
        self.manifest['state'] = 'finished'
        self.save()
        # Final archive includes cleanup status.
        self.export()

    def execute(self):
        if self.args.operation == 'start':
            self.start()
            return
        self.load()
        self.sync_tools()
        operation = self.args.operation
        if self.manifest['state'] != 'ready' and operation not in {'export', 'status', 'finish'}:
            raise LoopError('Task VM is not ready; inspect status/export and start a fresh task')
        if operation in {'build', 'test', 'oracle', 'lint', 'release', 'review'}:
            self.sync_snapshot()
            if operation == 'lint':
                with tarfile.open(self.directory / 'source/source.tgz') as archive:
                    mintfile = archive.extractfile('Mintfile').read()
                cache_root = Path(self.manifest.get('mint_cache_root', str(Path.home() / '.cache/arcadia-ci-mint')))
                self.manifest['mint_cache'] = str(cache_root / 'native-loop' / mint_cache_key(self.manifest['image'], mintfile))
                self.save()
            arguments = []
            if self.args.integration:
                if not self.manifest.get('integration'):
                    raise LoopError('Run integration first; no live backend fallback')
                arguments = ['integration', self.manifest['integration']['guest_url']]
            if operation == 'release':
                if not self.args.base_url:
                    raise LoopError('--base-url is required for release')
                arguments = [self.args.base_url]
            if operation == 'review' and self.args.live_review:
                arguments = ['live-review', *arguments]
            try:
                self.guest(operation, *arguments)
                if operation == 'lint' and self.manifest.get('mint_cache'):
                    publish_mint_cache(self.directory / 'mint', self.manifest['mint_cache'])
            finally:
                self.export()
        elif operation == 'integration':
            from integration import start
            try:
                self.manifest['integration'] = start(self.directory, self.manifest, self.tart, self.args.integration_source)
                self.save()
            finally:
                self.export()
        elif operation == 'view':
            ip = run([self.tart, 'ip', self.manifest['vm']], capture_output=True, text=True).stdout.strip()
            print(json.dumps({'guest_vnc': f'{ip}:5900', 'credentials': 'Official Tart image credentials: https://tart.run/quick-start/',
                              'vm': self.manifest['vm'], 'image': self.manifest['image'],
                              'review': 'Run native-loop review in another terminal; launch the task viewer through native computer control.'}))
        elif operation == 'export':
            self.export()
        elif operation == 'finish':
            self.finish()
        elif operation == 'status':
            print(json.dumps(self.manifest, indent=2))


def remote(args):
    """Install immutable helper copy and transfer only explicit source snapshots over trusted SSH."""
    if not re.fullmatch(r'[A-Za-z0-9_.@-]+', args.host) or args.host.startswith('-'):
        raise LoopError('Invalid SSH host alias')
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', args.host]
    tools_hash = hashlib.sha256(b''.join(p.read_bytes() for p in sorted(TOOLS.glob('*')) if p.is_file())).hexdigest()[:12]
    remote_tools = f'/tmp/arcadia-native-tools-{tools_hash}'
    run(ssh + [shlex.join(['mkdir', '-p', remote_tools])])
    run(['scp', '-q', *[str(p) for p in TOOLS.glob('*') if p.is_file() and p.suffix in {'.py', '.sh'}], f'{args.host}:{remote_tools}/'])
    arguments = ['python3', remote_tools + '/runner.py', '--root', args.root, args.operation, args.task]
    if args.operation in {'start', 'build', 'test', 'oracle', 'lint', 'release', 'review'}:
        with tempfile.TemporaryDirectory(prefix='arcadia-source-') as temporary:
            archive = Path(temporary) / 'source.tgz'
            snapshot(Path(args.source).resolve(), archive)
            incoming = f'/tmp/arcadia-source-{uuid.uuid4().hex}.tgz'
            run(['scp', '-q', str(archive), f'{args.host}:{incoming}'])
        arguments += ['--snapshot', incoming, '--revision', source_revision(Path(args.source).resolve())]
    else:
        incoming = None
    if args.operation == 'start':
        arguments += ['--image', args.image]
        if args.mint_seed:
            arguments += ['--mint-seed', args.mint_seed]
    if args.integration:
        arguments += ['--integration']
    if args.live_review:
        arguments += ['--live-review']
    if args.base_url:
        arguments += ['--base-url', args.base_url]
    if args.operation == 'integration':
        # Explicit tracked/working source subset for a disposable container build, never secrets/state.
        with tempfile.TemporaryDirectory(prefix='arcadia-integration-') as temporary:
            archive = Path(temporary) / 'integration.tgz'
            integration_snapshot(Path(args.source).resolve(), archive)
            integration_incoming = f'/tmp/arcadia-integration-{uuid.uuid4().hex}.tgz'
            run(['scp', '-q', str(archive), f'{args.host}:{integration_incoming}'])
        arguments += ['--integration-source', integration_incoming]
    try:
        if args.operation == 'view':
            result = run(ssh + [shlex.join(arguments)], timeout=60, capture_output=True, text=True)
            print(result.stdout, end='')
            viewer = json.loads(result.stdout)
            start_viewer(args, viewer)
        else:
            run(ssh + [shlex.join(arguments)], timeout=3000)
    finally:
        if args.operation == 'finish':
            stop_viewer(args)
        if incoming:
            run(ssh + [shlex.join(['rm', '-f', incoming])])
        if args.operation in {'start', 'export', 'finish', 'test', 'oracle', 'lint', 'build', 'release', 'review', 'integration'}:
            destination = Path(args.artifacts or f'.native-loop/{args.task}').resolve()
            destination.mkdir(parents=True, exist_ok=True)
            archive_name = 'evidence.tgz' if args.operation == 'export' else 'review.tgz'
            remote_archive = str(Path(args.root) / args.task / archive_name)
            copied = subprocess.run(['scp', '-q', f'{args.host}:{remote_archive}', str(destination / archive_name)])
            if copied.returncode == 0:
                with tarfile.open(destination / archive_name) as archive:
                    # Our own archive contains only task artifacts; reject traversal/links anyway.
                    safe_extract(archive, destination)
                print(f'Local evidence: {destination}', flush=True)
                if args.operation == 'finish':
                    print(f'Full results retained: {args.host}:{Path(args.root) / args.task / "evidence.tgz"}; use export to download', flush=True)
            else:
                raise LoopError('Evidence transfer failed; remote task evidence retained, retry export')


def viewer_file(args):
    directory = Path(args.artifacts or f'.native-loop/{args.task}').resolve()
    directory.mkdir(parents=True, exist_ok=True)
    return directory / 'viewer.json'


def stop_viewer(args):
    path = viewer_file(args)
    if not path.exists():
        return
    viewer = json.loads(path.read_text())
    if viewer.get('owner') != OWNER or viewer.get('task') != args.task or viewer.get('host') != args.host:
        raise LoopError('Viewer ownership mismatch')
    command = subprocess.run(['ps', '-p', str(viewer['pid']), '-o', 'command='], capture_output=True, text=True).stdout
    if viewer['forward'] in command and args.host in command and 'ssh' in command:
        os.kill(viewer['pid'], signal.SIGTERM)
    path.unlink()


def start_viewer(args, viewer):
    stop_viewer(args)
    guest_ip, guest_port = viewer['guest_vnc'].rsplit(':', 1)
    ipaddress.ip_address(guest_ip)
    if guest_port != '5900':
        raise LoopError('Unexpected guest viewer port')
    port = available_port()
    forward = f'127.0.0.1:{port}:{guest_ip}:5900'
    path = viewer_file(args)
    with path.with_suffix('.log').open('w') as log:
        process = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlMaster=no',
            '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', forward, args.host],
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    atomic_json(path, {'owner': OWNER, 'task': args.task, 'host': args.host, 'pid': process.pid, 'forward': forward, 'port': port,
                       'vm': viewer['vm'], 'image': viewer['image']})
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=2) as connection:
                if connection.recv(12).startswith(b'RFB '):
                    print(f'Native viewer endpoint: vnc://127.0.0.1:{port} (task-owned tunnel)', flush=True)
                    return
        except OSError:
            pass
        time.sleep(0.5)
    stop_viewer(args)
    raise LoopError('Task viewer tunnel did not provide an RFB response within 15s')


def safe_extract(archive, destination):
    for member in archive.getmembers():
        path = (destination / member.name).resolve()
        if not path.is_relative_to(destination.resolve()) or member.issym() or member.islnk():
            raise LoopError('Unsafe archive entry')
    archive.extractall(destination)


def integration_snapshot(source, output):
    names = ['.dockerignore', 'Dockerfile', 'package.json', 'package-lock.json', 'server', 'test-environment', 'index.html', 'tsconfig.json', 'vite.config.js', 'public', 'src']
    with tarfile.open(output, 'w:gz') as archive:
        for name in names:
            def include(info):
                if any(p in {'state', 'runtime.env', 'node_modules', '.env'} for p in Path(info.name).parts):
                    return None
                if info.issym() or info.islnk():
                    raise LoopError('Integration snapshot must not contain links')
                return info
            archive.add(source / name, arcname=name, filter=include)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default=os.environ.get('NATIVE_LOOP_HOST'))
    parser.add_argument('--root', default=f'/tmp/arcadia-native-loop-{os.getuid()}')
    parser.add_argument('operation', choices=['start', 'build', 'test', 'oracle', 'review', 'view', 'integration', 'lint', 'release', 'export', 'finish', 'status'])
    parser.add_argument('task')
    parser.add_argument('--source', default=os.getcwd())
    parser.add_argument('--artifacts')
    parser.add_argument('--mint-seed', default=os.environ.get('MINT_CACHE'), help='Read-only seed copied into the private task Mint cache (path on VM host)')
    parser.add_argument('--image', default=os.environ.get('TART_IMAGE', IMAGE))
    parser.add_argument('--integration', action='store_true')
    parser.add_argument('--live-review', action='store_true', help='Opt-in bounded interactive guest session; review is background by default')
    parser.add_argument('--base-url')
    parser.add_argument('--snapshot', help=argparse.SUPPRESS)
    parser.add_argument('--revision', help=argparse.SUPPRESS)
    parser.add_argument('--integration-source', help=argparse.SUPPRESS)
    args = parser.parse_args()
    os.environ['PATH'] = '/opt/homebrew/bin:/usr/local/bin:' + os.environ.get('PATH', '/usr/bin:/bin')
    validate_task(args.task)
    try:
        if args.host:
            remote(args)
        else:
            root = Path(args.root).resolve()
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            with (root / (args.task + '.lock')).open('w') as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as error:
                    raise LoopError('Another operation owns this task; wait for it to complete') from error
                Task(args).execute()
    except (LoopError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f'native-loop: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.modules['runner'] = sys.modules[__name__]
    sys.exit(main())
