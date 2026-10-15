"""Guest-only compile check; this does not execute behavioral UI tests."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--run', required=True)
    args = parser.parse_args()
    artifacts = args.artifacts
    source = Path.home() / ('arcadia-ios-ci-' + args.run)
    report = {'scope': 'iOS app and UI-test bundle compilation; no UI tests executed',
              'source_sha256': args.sha, 'passed': False}
    try:
        if hashlib.sha256(args.archive.read_bytes()).hexdigest() != args.sha:
            raise RuntimeError('Source archive hash mismatch')
        source.mkdir(exist_ok=False)
        with tarfile.open(args.archive) as archive:
            for member in archive:
                path = (source / member.name).resolve()
                if not path.is_relative_to(source) or not (member.isfile() or member.isdir()):
                    raise RuntimeError('Unsafe source archive member')
            archive.extractall(source)
        sys.path.insert(0, str(source / 'scripts'))
        sys.path.insert(0, str(source / 'test-environment/native'))
        from native_preview.environment import toolchain
        from native_loop.progress import execute
        from source_archive import guard_source
        facts, env = toolchain()
        (artifacts / 'toolchain.json').write_text(json.dumps(facts, indent=2) + '\n')
        guard_source(source, args.archive, artifacts / 'source-before.json')
        command = ['/usr/bin/env', 'DEVELOPER_DIR=' + env['DEVELOPER_DIR'], 'xcodebuild',
                   '-project', str(source / 'Arcadia/Arcadia.xcodeproj'), '-scheme', 'ArcadiaMobile',
                   '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator',
                   '-derivedDataPath', str(source / 'derived'), '-skipMacroValidation',
                   '-onlyUsePackageVersionsFromResolvedFile', 'CODE_SIGN_IDENTITY=-',
                   'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=', 'build-for-testing']
        status = execute(str(artifacts / 'build.log'), command)
        guard_source(source, args.archive, artifacts / 'source-after.json')
        products = source / 'derived/Build/Products/Debug-iphonesimulator'
        expected = [products / 'Arcadia.app', products / 'ArcadiaMobileUITests-Runner.app']
        report.update({'exit_code': status, 'products': [str(path) for path in expected],
                       'passed': status == 0 and all(path.is_dir() for path in expected)})
        if not report['passed']:
            raise RuntimeError('iOS compile check failed; see build.log')
        print('PASS: iOS app and UI-test bundle compiled. No UI tests executed.', flush=True)
        return 0
    except Exception as error:
        report['error'] = str(error)
        print(str(error), file=sys.stderr)
        return 1
    finally:
        (artifacts / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
