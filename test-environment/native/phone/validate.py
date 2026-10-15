#!/usr/bin/env python3
"""Explicit guest-only iPhone restoration acceptance; never creates VMs."""
import hashlib
import json
from pathlib import Path
import tarfile


def guard_source(repository, archive_path, report_path):
    mismatches = []
    count = 0
    repository = repository.resolve()
    with tarfile.open(archive_path) as archive:
        for entry in archive:
            if not entry.isfile():
                continue
            path = (repository / entry.name).resolve()
            if not path.is_relative_to(repository):
                raise RuntimeError('Unsafe source archive member')
            expected = hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
            actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            count += 1
            if actual != expected:
                mismatches.append(entry.name)
    report = {'source_sha256': hashlib.sha256(archive_path.read_bytes()).hexdigest(),
              'checked_files': count, 'mismatches': mismatches, 'passed': count > 0 and not mismatches}
    report_path.write_text(json.dumps(report, indent=2))
    if not report['passed']:
        raise RuntimeError('Immutable source archive mismatch')


CONFIGURATION = 'arcadia-jellyfin-fixture.json'
MARKER = 'arcadia-phone-validation.json'
SELECTION = ('ArcadiaMobileUITests/RestoringRealListeningTests/'
             'testRealJellyfinRestoresTheSameQueueAndPositionPausedAfterRestart')
RUNNER = 'tokyo.drift.ArcadiaMobileUITests.xctrunner'


class PrivateStaging:
    def __init__(self, configuration, owner):
        self.configuration = configuration
        self.owner = owner
        self.sha = hashlib.sha256(configuration.read_bytes()).hexdigest()
        self.directories = set()

    def install(self, documents):
        documents.mkdir(parents=True, exist_ok=True)
        marker, destination = documents / MARKER, documents / CONFIGURATION
        if documents in self.directories:
            if not marker.exists() or json.loads(marker.read_text()) != self.owner:
                raise RuntimeError('Private staging ownership changed')
            if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != self.sha:
                raise RuntimeError('Private staging configuration changed')
            return
        if marker.exists() or destination.exists():
            # XCTest can migrate the runner by copying this run's Documents.
            # Adopt only an unchanged pair carrying our unique owner token.
            try:
                copied_owner = marker.exists() and json.loads(marker.read_text()) == self.owner
            except (OSError, ValueError):
                copied_owner = False
            if (copied_owner and destination.is_file()
                    and hashlib.sha256(destination.read_bytes()).hexdigest() == self.sha):
                self.directories.add(documents)
                return
            raise RuntimeError('Refusing to replace pre-existing phone acceptance staging')
        # Exclusive creation prevents claiming another driver's pre-existing input.
        with marker.open('x') as stream:
            json.dump(self.owner, stream)
        self.directories.add(documents)
        with destination.open('xb') as stream:
            destination.chmod(0o600)
            stream.write(self.configuration.read_bytes())

    def cleanup(self, directories):
        cleaned, refused = [], []
        for directory in sorted(set(directories) | self.directories):
            marker, configuration = directory / MARKER, directory / CONFIGURATION
            try:
                owned = marker.exists() and json.loads(marker.read_text()) == self.owner
            except (OSError, ValueError):
                owned = False
            if not owned:
                continue
            if configuration.exists():
                if hashlib.sha256(configuration.read_bytes()).hexdigest() != self.sha:
                    refused.append(str(configuration))
                    continue
                configuration.unlink()
            marker.unlink()
            cleaned.append(str(directory))
        return {'owned_documents_cleaned': cleaned, 'owner': self.owner,
                'private_configuration_sha256': self.sha, 'refused_changed_configuration': refused}


def run(*command, **kwargs):
    import subprocess
    return subprocess.run(list(map(str, command)), check=True, **kwargs)


def output(*command):
    import subprocess
    return subprocess.check_output(list(map(str, command)), text=True, timeout=30).strip()


def runner_documents(device):
    return Path(output('xcrun', 'simctl', 'get_app_container', device, RUNNER, 'data')) / 'Documents'


def reap(child):
    import subprocess
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def native_preflight(args, root):
    inventory = json.loads(output('xcrun', 'simctl', 'list', 'devices', 'booted', '--json'))
    booted = [device for group in inventory['devices'].values() for device in group if device['state'] == 'Booted']
    if len(booted) != 1 or booted[0]['udid'] != args.device or not booted[0]['name'].startswith('iPhone'):
        raise RuntimeError('The owned iPhone must be the only booted simulator')
    (root / 'device.json').write_text(json.dumps(booted[0], indent=2))
    # This helper verifies AX trust, selected owned Device Hub window and native menu availability.
    with (root / 'native-preflight.txt').open('w') as log:
        run(args.native_control, args.device, booted[0]['name'], 'inspect', stdout=log, timeout=45)
    alerts = output(args.alerts_helper)
    (root / 'native-alerts.jsonl').write_text(alerts + '\n')
    if 'trusted=true' not in alerts.splitlines():
        raise RuntimeError('Native alert scanner lacks guest Accessibility permission')
    for line in alerts.splitlines():
        if line.startswith('{'):
            record = json.loads(line)
            if record['bundle'] == 'com.apple.UserNotificationCenter' and record['windows']:
                raise RuntimeError('Guest native notification requires a scoped decision before capture')


def coordinate_capture(args, root, staging, stopped, failures, started):
    """Follow only this run's public IPC while XCTest may reinstall its runner."""
    import shutil
    import time
    import subprocess
    capture = root / 'audio'
    protocol = None
    def checkpoint(stage, **fields):
        record = {'stage': stage, 'timestamp': time.time(), **fields}
        with (root / 'coordinator-events.jsonl').open('a') as stream:
            stream.write(json.dumps(record) + '\n')
    checkpoint('waiting-for-public-target')
    deadline = time.monotonic() + 300
    try:
        while time.monotonic() < deadline:
            if stopped.is_set() and not (protocol is not None and (protocol / 'done').exists()):
                raise RuntimeError('Public UI ended before capture completion')
            try:
                documents = runner_documents(args.device)
            except subprocess.CalledProcessError:
                time.sleep(0.2)
                continue
            staging.install(documents)
            candidate = documents / 'mobile-restore-58'
            request = candidate / 'target-request'
            if protocol is None and request.exists() and request.stat().st_mtime >= started:
                rows = [row for row in output('ps', '-axo', 'pid,command').splitlines()
                        if '/' + args.device + '/' in row and '/Arcadia.app/Arcadia' in row]
                checkpoint('public-target-observed', matching_app_processes=len(rows))
                if len(rows) != 1:
                    raise RuntimeError('Expected exactly one actual app PID for the owned iPhone')
                pid = int(rows[0].strip().split()[0])
                (capture / 'attribution.txt').write_text(rows[0] + '\n')
                (capture / 'target.json').write_text(json.dumps({'pid': pid}))
                ready_deadline = time.monotonic() + 30
                while not (capture / 'capture-ready').exists():
                    if stopped.is_set() or time.monotonic() > ready_deadline:
                        raise RuntimeError('Actual capture route was not ready')
                    time.sleep(0.2)
                shutil.copyfile(capture / 'capture-ready', candidate / 'capture-ready')
                protocol = candidate
                checkpoint('capture-ready', app_pid=pid)
            if protocol is not None:
                for name in ['phases.json', 'queue-before.json']:
                    path = protocol / name
                    if path.exists():
                        shutil.copyfile(path, capture / name)
                if (protocol / 'done').exists():
                    (capture / 'protocol-completed').touch()
                    checkpoint('completed')
                    return
            time.sleep(0.2)
        raise TimeoutError('Public restoration journey did not complete')
    except Exception as error:
        checkpoint('failed', error_type=type(error).__name__, message=str(error))
        failures.append(error)
    finally:
        if protocol is not None:
            for name in ['phases.json', 'queue-before.json']:
                try:
                    shutil.copyfile(protocol / name, capture / name)
                except FileNotFoundError:
                    pass
        (capture / 'done').touch()


def export_results(repository, root, source_sha):
    import os
    result = root / 'results.xcresult'
    if not result.exists():
        (root / 'verification.json').write_text(json.dumps({
            'verified': False, 'source_sha256': source_sha, 'requested_tests': [SELECTION],
            'error': 'No XCTest result bundle'}))
        raise RuntimeError('No XCTest result bundle')
    for operation in ['summary', 'tests']:
        with (root / (operation + '.json')).open('w') as log:
            run('xcrun', 'xcresulttool', 'get', 'test-results', operation,
                '--path', result, '--format', 'json', stdout=log)
    run('xcrun', 'xcresulttool', 'export', 'attachments', '--path', result,
        '--output-path', root / 'attachments')
    run('python3', repository / 'scripts/native_loop/verification.py', root / 'tests.json',
        root / 'verification.json', SELECTION, env=dict(os.environ, ARCADIA_SOURCE_SHA256=source_sha))
    summary = json.loads((root / 'summary.json').read_text())
    if summary.get('passedTests') != 1 or summary.get('failedTests', 0) or summary.get('skippedTests', 0):
        raise RuntimeError('Exact restoration method must pass once with zero skips')


def main():
    import argparse
    import fcntl
    import os
    import subprocess
    import threading
    import time
    import uuid
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['restore'])
    parser.add_argument('--device', required=True)
    for name in ['output', 'derived-data', 'source-archive', 'configuration', 'audio-helper',
                 'native-control', 'alerts-helper']:
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    for name in ['output', 'derived_data', 'source_archive', 'configuration', 'audio_helper',
                 'native_control', 'alerts_helper']:
        setattr(args, name, getattr(args, name).resolve())
    repository = Path(__file__).resolve().parents[3]
    root = args.output.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    source_sha = hashlib.sha256(args.source_archive.read_bytes()).hexdigest()
    guard_source(repository, args.source_archive, root / 'source-before.json')
    helpers = {name: hashlib.sha256(getattr(args, name).read_bytes()).hexdigest()
               for name in ['audio_helper', 'native_control', 'alerts_helper']}
    if helpers['audio_helper'] != '5aba931e1baf63f5cba3f96ee882a753391c1706cc6054a42090a9d5f55a255c':
        raise RuntimeError('Use the accepted tap-only audio helper')
    (root / 'driver.json').write_text(json.dumps({
        'source_sha256': source_sha, 'driver_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'helper_sha256': helpers, 'requested_tests': [SELECTION],
        'verification_sha256': hashlib.sha256((repository / 'scripts/native_loop/verification.py').read_bytes()).hexdigest(),
        'audio_verifier_sha256': hashlib.sha256((repository / 'test-environment/native/verify-audio.py').read_bytes()).hexdigest()}, indent=2))
    common = ['xcodebuild', '-project', str(repository / 'Arcadia/Arcadia.xcodeproj'), '-scheme', 'ArcadiaMobile',
              '-destination', 'platform=iOS Simulator,id=' + args.device, '-derivedDataPath', str(args.derived_data),
              '-skipMacroValidation', '-disableAutomaticPackageResolution', '-onlyUsePackageVersionsFromResolvedFile',
              '-collect-test-diagnostics', 'never', '-parallel-testing-enabled', 'NO', '-only-testing:' + SELECTION]
    # Build/install and all native preflight work precede the capture arming deadline.
    with (root / 'build.log').open('w') as log:
        run(*common, 'build-for-testing', stdout=log, stderr=subprocess.STDOUT)
    runner = args.derived_data / 'Build/Products/Debug-iphonesimulator/ArcadiaMobileUITests-Runner.app'
    run('xcrun', 'simctl', 'install', args.device, runner)
    native_preflight(args, root)
    lock = (Path.home() / '.arcadia-phone-capture.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    # Reject existing producers instead of killing or attaching to another capture.
    producers = [row for row in output('ps', '-axo', 'pid,command').splitlines()
                 if len(row.strip().split(None, 1)) == 2
                 and row.strip().split(None, 1)[1].startswith(str(args.audio_helper.resolve()) + ' ')]
    if producers:
        raise RuntimeError('An audio capture helper is already running')
    owner = {'controller': 'phone-restore', 'token': str(uuid.uuid4()),
             'source_sha256': source_sha, 'output': str(root)}
    staging = PrivateStaging(args.configuration, owner)
    documents = runner_documents(args.device)
    children = []
    failures = []
    stopped = threading.Event()
    coordinator = None
    capture = root / 'audio'
    capture.mkdir()
    test_failure = None
    cleanup_failure = None
    try:
        staging.install(documents)
        (root / 'staging.json').write_text(json.dumps({'initial_documents': str(documents), 'owner': owner}, indent=2))
        started = time.time()
        log = (capture / 'capture.log').open('w')
        child = subprocess.Popen([str(args.audio_helper), str(capture), '--unmuted', '--paused-output'],
                                 stdout=log, stderr=subprocess.STDOUT)
        children.append((child, log))
        armed_deadline = time.monotonic() + 15
        while not (capture / 'armed').exists():
            if child.poll() is not None or time.monotonic() > armed_deadline:
                raise RuntimeError('Owned capture helper did not arm')
            time.sleep(0.2)
        coordinator = threading.Thread(target=coordinate_capture,
                                       args=(args, root, staging, stopped, failures, started))
        coordinator.start()
        with (root / 'test.log').open('w') as test_log:
            run(*common, '-resultBundlePath', root / 'results.xcresult', 'test-without-building',
                stdout=test_log, stderr=subprocess.STDOUT, timeout=360)
    except Exception as error:
        test_failure = error
    finally:
        (capture / 'driver.finished').touch()
        stopped.set()
        if coordinator is not None:
            coordinator.join(timeout=40)
            if coordinator.is_alive():
                cleanup_failure = RuntimeError('Configuration/capture coordinator did not finish')
        (capture / 'done').touch()
        child_results = []
        for child, log in children:
            reap(child)
            log.close()
            child_results.append({'pid': child.pid, 'returncode': child.returncode})
        (root / 'children.json').write_text(json.dumps(child_results, indent=2))
        try:
            current = runner_documents(args.device)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            current = documents
        try:
            cleanup = staging.cleanup([documents, current])
        except Exception as error:
            cleanup_failure = error
            cleanup = {'error': type(error).__name__, 'refused_changed_configuration': []}
        (root / 'staging-cleanup.json').write_text(json.dumps(cleanup, indent=2))
        (capture / 'armed').unlink(missing_ok=True)
        lock.close()
        try:
            guard_source(repository, args.source_archive, root / 'source-after.json')
        except Exception as error:
            cleanup_failure = error
    # Always export raw XCTest failure evidence before evaluating the final gates.
    export_failure = None
    try:
        export_results(repository, root, source_sha)
    except Exception as error:
        export_failure = error
    (root / 'failures.json').write_text(json.dumps([
        {'stage': name, 'error_type': type(error).__name__, 'message': str(error)}
        for name, error in [('test', test_failure), ('cleanup', cleanup_failure), ('export', export_failure)]
        if error is not None
    ] + [{'stage': 'coordinator', 'error_type': type(error).__name__, 'message': str(error)}
         for error in failures], indent=2))
    for error in [*failures, test_failure, cleanup_failure, export_failure]:
        if error is not None:
            raise error
    if cleanup['refused_changed_configuration']:
        raise RuntimeError('Private configuration changed; inspect staging-cleanup.json')
    if any(item['returncode'] for item in child_results):
        raise RuntimeError('An owned capture child failed')
    if not (capture / 'protocol-completed').exists():
        raise RuntimeError('Missing complete public restoration IPC')
    run('python3', repository / 'test-environment/native/verify-audio.py', capture, '--profile', 'iphone-restore')
    print('PASS: exact canonical ' + SELECTION + '; source ' + source_sha)


if __name__ == '__main__':
    main()
