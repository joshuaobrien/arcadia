"""Run guest commands with controlled phase output instead of streaming raw logs."""
import json
from pathlib import Path
import subprocess
import sys
import time


def classify(line):
    if 'SwiftCompile' in line or 'SwiftEmitModule' in line:
        return 'dependency compilation' if any(name in line for name in ('SwiftSyntax', 'SwiftParser', 'SwiftDiagnostics', 'Mockable', 'XCTestDynamicOverlay', 'IssueReporting')) else 'app compilation'
    if 'Test Suite' in line or 'Testing started' in line or ' t = ' in line:
        return 'behavioral tests'
    if 'Resolve Package Graph' in line or 'Fetching from' in line:
        return 'dependency resolution'
    if 'CodeSign ' in line:
        return 'signing'
    return None


def execute(log_path, command):
    started = time.monotonic()
    phase = ('lint-tool bootstrap' if 'bootstrap' in command else 'lint validation') if Path(command[0]).name == 'mint' else ('format validation' if 'swift-format' in command else 'build preparation')
    phases = [{'phase': phase, 'seconds': 0}]
    last_report = started
    print(f'[native-loop] {phase}', flush=True)
    with Path(log_path).open('w') as log, Path(log_path).open() as reader:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        while True:
            detected = None
            for line in reader.readlines():
                detected = classify(line) or detected
            if detected and detected != phase:
                phase = detected
                phases.append({'phase': phase, 'seconds': round(time.monotonic() - started, 2)})
                print(f'[native-loop] {phase} ({time.monotonic() - started:.0f}s elapsed)', flush=True)
                last_report = time.monotonic()
            if process.poll() is not None:
                break
            if time.monotonic() - last_report >= 15:
                print(f'[native-loop] {phase}: still running ({time.monotonic() - started:.0f}s elapsed)', flush=True)
                last_report = time.monotonic()
            time.sleep(0.5)
    elapsed = round(time.monotonic() - started, 2)
    Path(log_path + '.phases.json').write_text(json.dumps({'seconds': elapsed, 'exit_code': process.returncode, 'phases': phases}, indent=2) + '\n')
    print(f'[native-loop] command {"passed" if process.returncode == 0 else "failed"} in {elapsed}s; log: {Path(log_path).name}', flush=True)
    return process.returncode


if __name__ == '__main__':
    sys.exit(execute(sys.argv[1], sys.argv[2:]))
