"""One additive CI lane, using the prepared local Xcode27.1 template and Guest Agent."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time
import uuid


def run(*args, **kwargs):
    return subprocess.run(list(map(str, args)), check=True, **kwargs)


def interrupted(signum, frame):
    raise KeyboardInterrupt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--template', default=os.environ.get('NATIVE_IOS_TEMPLATE', 'arcadia-mobile-xcode-27-1-27a9275'))
    parser.add_argument('--artifacts', type=Path, default=Path('artifacts/native-ios'))
    args = parser.parse_args(argv)
    source, artifacts = args.source.resolve(), args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    vm = 'arcadia-ios-ci-' + token[:12]
    report = {'vm': vm, 'template': args.template, 'scope': 'iOS compilation only', 'passed': False}
    created = False
    process = None
    status = 1
    inputs_directory = tempfile.TemporaryDirectory(prefix='arcadia-ios-ci-')
    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        inputs = Path(inputs_directory.name)
        archive = inputs / 'source.tgz'
        names = ['Arcadia', 'scripts/native_ios/guest.py', 'scripts/native_preview/environment.py',
                 'scripts/native_loop/progress.py', 'test-environment/native/source_archive.py']
        def include(member):
            if any(part in {'xcuserdata', 'DerivedData', '.build', '.DS_Store', '__pycache__'}
                   for part in Path(member.name).parts):
                return None
            if not (member.isfile() or member.isdir()):
                raise RuntimeError('Source snapshot cannot contain links: ' + member.name)
            return member
        with tarfile.open(archive, 'w:gz') as output:
            for name in names:
                output.add(source / name, arcname=name, filter=include)
        sha = hashlib.sha256(archive.read_bytes()).hexdigest()
        report['source_sha256'] = sha
        shutil.copyfile(source / 'scripts/native_ios/guest.py', inputs / 'guest.py')
        print('Cloning prepared iOS template → ' + vm, flush=True)
        run('tart', 'clone', args.template, vm, timeout=300)
        created = True
        with (artifacts / 'vm.log').open('w') as log:
            process = subprocess.Popen(['tart', 'run', '--no-graphics', '--no-audio', '--no-clipboard',
                                        '--dir=input:' + str(inputs) + ':ro',
                                        '--dir=artifacts:' + str(artifacts), vm],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        print('Waiting for guest agent (maximum120s)…', flush=True)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                ready = subprocess.run(['tart', 'exec', vm, '/usr/bin/true'], timeout=8,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if ready.returncode == 0:
                    break
            except subprocess.TimeoutExpired:
                pass
            if process.poll() is not None:
                raise RuntimeError('VM exited during startup; see vm.log')
            time.sleep(2)
        else:
            raise RuntimeError('Guest agent readiness timed out')
        run('tart', 'exec', vm, '/usr/bin/python3', '/Volumes/My Shared Files/input/guest.py',
            '--archive', '/Volumes/My Shared Files/input/source.tgz', '--sha', sha,
            '--artifacts', '/Volumes/My Shared Files/artifacts', '--run', token, timeout=1200)
        verdict = json.loads((artifacts / 'verification.json').read_text())
        if not verdict.get('passed') or verdict['source_sha256'] != sha:
            raise RuntimeError('Missing or mismatched iOS compilation verdict')
        status = 0
    except KeyboardInterrupt:
        report['error'] = 'Cancelled'
        status = 130
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report['error'] = str(error)
        print('iOS CI failed: ' + str(error), flush=True)
    finally:
        cleanup_errors = []
        if created:
            try:
                stopped = subprocess.run(['tart', 'stop', vm], capture_output=True, text=True, timeout=30)
                if stopped.returncode:
                    cleanup_errors.append('stop: ' + stopped.stderr)
            except (OSError, subprocess.SubprocessError) as error:
                cleanup_errors.append('stop: ' + str(error))
            if process:
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    try:
                        process.kill()
                        process.wait(timeout=10)
                    except (OSError, subprocess.SubprocessError) as error:
                        cleanup_errors.append('runner: ' + str(error))
            try:
                removed = subprocess.run(['tart', 'delete', vm], capture_output=True, text=True, timeout=30)
                report['vm_removed'] = removed.returncode == 0
                if not report['vm_removed']:
                    cleanup_errors.append('delete: ' + removed.stderr)
            except (OSError, subprocess.SubprocessError) as error:
                cleanup_errors.append('delete: ' + str(error))
                report['vm_removed'] = False
            if cleanup_errors:
                report['cleanup_errors'] = cleanup_errors
                status = 1
        inputs_directory.cleanup()
        report['passed'] = status == 0
        (artifacts / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
        signal.signal(signal.SIGTERM, previous)
    return status
