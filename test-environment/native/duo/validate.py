#!/usr/bin/env python3
"""Explicit guest-only Duo acceptance; never creates VMs or opens host viewers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode', choices=['fixture', 'short', 'real'])
parser.add_argument('--device', required=True)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--derived-data', required=True, type=Path)
parser.add_argument('--source-archive', required=True, type=Path)
parser.add_argument('--control', required=True, type=Path)
parser.add_argument('--orientation', type=Path)
parser.add_argument('--audio-helper', type=Path)
parser.add_argument('--configuration', type=Path)
args = parser.parse_args()
repository = Path(__file__).resolve().parents[3]
root = args.output.resolve()
root.mkdir(mode=0o700, parents=True, exist_ok=False)
(root / 'artifacts').mkdir()
source_sha = hashlib.sha256(args.source_archive.read_bytes()).hexdigest()

def run(*command, **kwargs):
    return subprocess.run(list(map(str, command)), check=True, **kwargs)

def output(*command):
    return subprocess.check_output(list(map(str, command)), text=True).strip()

def guard_source(name):
    mismatches = []
    count = 0
    with tarfile.open(args.source_archive) as archive:
        for entry in archive:
            if not entry.isfile():
                continue
            path = repository / entry.name
            expected = hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
            actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
            count += 1
            if actual != expected:
                mismatches.append(entry.name)
    report = {'source_sha256': source_sha, 'checked_files': count, 'mismatches': mismatches, 'passed': not mismatches}
    (root / name).write_text(json.dumps(report, indent=2))
    if mismatches:
        raise RuntimeError('Immutable source archive mismatch')

guard_source('source-before.json')
inventory = json.loads(output('xcrun', 'simctl', 'list', 'devices', 'booted', '--json'))
booted = [device for devices in inventory['devices'].values() for device in devices if device['state'] == 'Booted']
if len(booted) != 1 or booted[0]['udid'] != args.device or 'Duo' not in booted[0]['name']:
    raise RuntimeError('The owned Duo must be the only booted simulator')
if args.mode == 'short' and not args.orientation:
    parser.error('short requires --orientation')
if args.mode == 'real' and (not args.configuration or not args.audio_helper):
    parser.error('real requires --configuration and --audio-helper')

# Establish an actual opened native prerequisite before login/browsing.
control = str(args.control.resolve())
run('open', str(Path(os.environ['DEVELOPER_DIR']) / 'Applications/DeviceHub.app'))
time.sleep(1)
try:
    run(control, 'option', 'down')
    time.sleep(1)
    bounds = json.loads(output(control, 'hinge-bounds'))
    radius = bounds['height'] / 2 + 2
    left, right = bounds['x'] + radius, bounds['x'] + bounds['width'] - radius
    y = bounds['y'] + bounds['height'] / 2
    run(control, 'drag', left + (right-left)*float(bounds['value'])/180, y, right, y)
finally:
    run(control, 'option', 'up')

methods = {'fixture': 'AdaptiveListeningTests/testNativeFoldsPreserveListeningQueueAndArtistRoute',
           'short': 'AdaptiveListeningTests/testClosedLandscapeKeepsTransportInsideActualShortWindow',
           'real': 'DuoRealListeningTests/testSingleRealSourceContinuesDuringNativeFolds'}
selection = 'ArcadiaMobileUITests/' + methods[args.mode]
common = ['xcodebuild', '-project', str(repository/'Arcadia/Arcadia.xcodeproj'), '-scheme', 'ArcadiaMobile',
          '-destination', 'platform=iOS Simulator,id='+args.device, '-derivedDataPath', str(args.derived_data),
          '-skipMacroValidation', '-collect-test-diagnostics', 'never', '-parallel-testing-enabled', 'NO',
          '-only-testing:'+selection]
with (root/'build.log').open('w') as log:
    run(*common, 'build-for-testing', stdout=log, stderr=subprocess.STDOUT)
runner = args.derived_data/'Build/Products/Debug-iphonesimulator/ArcadiaMobileUITests-Runner.app'
run('xcrun', 'simctl', 'install', args.device, runner)
container = Path(output('xcrun','simctl','get_app_container',args.device,'tokyo.drift.ArcadiaMobileUITests.xctrunner','data'))
documents = container/'Documents'
documents.mkdir(exist_ok=True)
marker = documents/'arcadia-duo-native-validation.json'
configuration = documents/'arcadia-jellyfin-duo-long-fixture.json'
if marker.exists() or (args.mode == 'real' and configuration.exists()):
    raise RuntimeError('Refusing to replace pre-existing native acceptance staging')
marker.write_text(json.dumps({'controller':'duo-native'}))
children = []
environment = dict(os.environ, ARCADIA_DUO_ROOT=str(root), DUO_DEVICE_ID=args.device,
                   ARCADIA_DUO_MODE=args.mode, ARCADIA_DUO_CONTROL=control)
if args.orientation:
    environment['ARCADIA_DUO_ORIENTATION'] = str(args.orientation.resolve())
if args.audio_helper:
    environment['ARCADIA_AUDIO_CAPTURE_HELPER'] = str(args.audio_helper.resolve())
try:
    if args.mode == 'real':
        data = json.loads(args.configuration.read_text())
        if data.get('duration_seconds') != 300 or data.get('expected_hz') != 600:
            raise RuntimeError('Real fold proof requires a separately owned300s600Hz source')
        shutil.copyfile(args.configuration, configuration)
        configuration.chmod(0o600)
        log = (root/'capture.log').open('w')
        children.append((subprocess.Popen(['python3',str(Path(__file__).with_name('capture.py'))], env=environment, stdout=log, stderr=subprocess.STDOUT),log))
    controller = 'short-controller.py' if args.mode == 'short' else 'controller.py'
    log = (root/'controller.log').open('w')
    children.append((subprocess.Popen(['python3',str(Path(__file__).with_name(controller))], env=environment, stdout=log, stderr=subprocess.STDOUT),log))
    result = root/'results.xcresult'
    with (root/'test.log').open('w') as log:
        run(*common, '-resultBundlePath', result, 'test-without-building', stdout=log, stderr=subprocess.STDOUT, timeout=360)
finally:
    (root/'audio/rendered-output').mkdir(parents=True,exist_ok=True)
    (root/'audio/rendered-output/driver.finished').touch()
    for child,log in children:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        log.close()
    marker.unlink(missing_ok=True)
    if args.mode == 'real':
        configuration.unlink(missing_ok=True)
    guard_source('source-after.json')

for operation, filename in [('summary','summary.json'),('tests','tests.json')]:
    with (root/filename).open('w') as log:
        run('xcrun','xcresulttool','get','test-results',operation,'--path',result,'--format','json',stdout=log)
run('xcrun','xcresulttool','export','attachments','--path',result,'--output-path',root/'attachments')
run('python3',repository/'scripts/native_loop/verification.py',root/'tests.json',root/'verification.json',selection,
    env=dict(os.environ,ARCADIA_SOURCE_SHA256=source_sha))
summary = json.loads((root/'summary.json').read_text())
if summary.get('skippedTests',0) or summary.get('failedTests',0) or summary.get('passedTests') != 1:
    raise RuntimeError('Canonical exact method must pass once with zero skips')
if args.mode == 'real':
    cycles = list((root/'artifacts').glob('fold-cycle-*'))
    if len(cycles) != 1:
        raise RuntimeError('Expected one actual native pose recording cycle')
    for name in ['direct','global']:
        capture = root/'audio/rendered-output'/name
        shutil.copyfile(cycles[0]/'native-phases.json', capture/'phases.json')
        run('python3',Path(__file__).with_name('verify-output.py'),capture)
print('PASS: exact canonical '+selection+'; source '+source_sha)
