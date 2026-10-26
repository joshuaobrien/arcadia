"""Explicit fixture XCTest selections in the native-loop task's owned simulator."""
import json
import os
from pathlib import Path
import subprocess
import sys

from iteration import ROOT, WORKSPACE, EXCHANGE, command, digest, prepare_device, sync_source


def main(task, run_id, platform, marker, *selections):
    if platform not in {'iphone', 'duo'} or marker != 'only-testing' or not selections:
        raise RuntimeError('Mobile tests require a platform and explicit selections')
    if any(not selection.startswith('ArcadiaMobileUITests/') for selection in selections):
        raise RuntimeError('Mobile tests require mobile UI test identifiers')
    output = EXCHANGE / run_id
    output.mkdir(exist_ok=True)
    inputs = sync_source(Path(os.environ['ARCADIA_SOURCE_ARCHIVE']))
    state_path = ROOT / 'iteration-devices.json'
    device = prepare_device(platform, json.loads(state_path.read_text()) if state_path.exists() else {})
    (output / 'device.json').write_text(json.dumps({'platform': platform, 'udid': device}) + '\n')
    (output / 'xcode.txt').write_text(command('xcodebuild', '-version') + '\n')
    (output / 'runtimes.json').write_text(command('xcrun', 'simctl', 'list', 'runtimes', '--json') + '\n')
    (output / 'diagnostics-policy.txt').write_text(
        ('full' if os.environ.get('ARCADIA_MOBILE_FULL_DIAGNOSTICS') == '1' else 'targeted') + '\n')
    arguments = ['xcodebuild', '-project', str(WORKSPACE / 'Arcadia/Arcadia.xcodeproj'),
                 '-scheme', 'ArcadiaMobile', '-configuration', 'Debug',
                 '-destination', 'platform=iOS Simulator,id=' + device,
                 '-derivedDataPath', str(ROOT / 'iteration-ios'), '-skipMacroValidation',
                 '-parallel-testing-enabled', 'NO',
                 *([] if os.environ.get('ARCADIA_MOBILE_FULL_DIAGNOSTICS') == '1'
                   else ['-collect-test-diagnostics', 'never']),
                 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=',
                 'PRODUCT_BUNDLE_IDENTIFIER=tokyo.drift.Arcadia.Iteration.Mobile',
                 *['-only-testing:' + selection for selection in selections],
                 '-resultBundlePath', str(output / 'tests.xcresult'), 'test']
    environment = dict(os.environ, TEST_RUNNER_ARCADIA_RUN_ID=run_id)
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('progress.py')),
                             str(output / 'test.log'), *arguments], env=environment)
    intact = all((WORKSPACE / name).is_file() and digest(WORKSPACE / name) == sha
                 for name, sha in inputs.items())
    (output / 'source-integrity.json').write_text(json.dumps({
        'source_sha256': os.environ['ARCADIA_SOURCE_SHA256'], 'files': inputs,
        'unchanged_after_test': intact}) + '\n')
    if not intact:
        raise RuntimeError('Tests changed source inputs')
    for operation in ['summary', 'tests']:
        (output / ('tests-' + ('tree' if operation == 'tests' else operation) + '.json')).write_text(
            command('xcrun', 'xcresulttool', 'get', 'test-results', operation,
                    '--path', output / 'tests.xcresult'))
    command(sys.executable, Path(__file__).with_name('verification.py'),
            output / 'tests-tree.json', output / 'verification.json', *selections)
    if result.returncode:
        raise RuntimeError('Mobile test failed; inspect test.log')


if __name__ == '__main__':
    main(*sys.argv[1:])
