"""Offline readiness checks: never install tools or repair app configuration."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

MINT_VERSION = '0.18.0'
XCODE_VERSION = 'Xcode 27.1\nBuild version 27A9275'


def check(source, output):
    report = {'ready': False, 'tools': {}, 'errors': []}
    def probe(name, command):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            report['errors'].append(name + ': missing or unavailable; reprovision the template')
            return ''
        text = result.stdout.strip()
        report['tools'][name] = text
        if result.returncode:
            report['errors'].append(name + ': check failed; reprovision the template (do not edit app configuration to bypass this)')
        return text
    mint = probe('mint', ['mint', '--version'])
    if mint and mint != 'Version: ' + MINT_VERSION:
        report['errors'].append('mint: expected ' + MINT_VERSION)
    xcode = probe('xcode', ['xcodebuild', '-version'])
    if xcode and xcode != XCODE_VERSION:
        report['errors'].append('xcode: expected ' + XCODE_VERSION.replace('\n', ', '))
    pin = re.search(r'^realm/SwiftLint@([^\s]+)$', (source / 'Mintfile').read_text(), re.M)
    if not pin:
        report['errors'].append('Mintfile: missing pinned SwiftLint version')
    elif mint:
        lint = probe('swiftlint', ['mint', 'run', '--no-install', 'realm/SwiftLint@' + pin[1], 'swiftlint', 'version'])
        if lint and lint.splitlines()[-1] != pin[1]:
            report['errors'].append('swiftlint: cached executable does not match Mintfile')
    probe('formatter', ['xcrun', 'swift-format', '--version'])
    with tempfile.TemporaryDirectory() as temporary:
        sample = Path(temporary) / 'Probe.swift'
        sample.write_text('let value = 1\n')
        probe('formatter_configuration', ['xcrun', 'swift-format', 'lint', '--strict', '--configuration', str(source / '.swift-format'), str(sample)])
    report['ready'] = not report['errors']
    output.write_text(json.dumps(report, indent=2) + '\n')
    for error in report['errors']:
        print('TEMPLATE_NOT_READY: ' + error)
    return report['ready']




def contract_hash(archive_path):
    import hashlib
    import tarfile
    with tarfile.open(archive_path) as archive:
        inputs = [MINT_VERSION.encode(), XCODE_VERSION.encode()] + [archive.extractfile(name).read() for name in ['Mintfile', '.swift-format']]
    return hashlib.sha256(b'\0'.join(inputs)).hexdigest()


def require_certificate(path, image, contract):
    try:
        certificate = json.loads(path.read_text())
    except (OSError, ValueError):
        raise RuntimeError('Template is not certified: provision and smoke-test it first; do not repair tools during an app task')
    if certificate.get('image') != image or certificate.get('contract_sha256') != contract:
        raise RuntimeError('Template or Mintfile/formatter configuration changed: recertify before starting an app task')
    if not certificate.get('ready'):
        raise RuntimeError('Template certificate is not ready')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    raise SystemExit(0 if check(args.source, args.output) else 1)

