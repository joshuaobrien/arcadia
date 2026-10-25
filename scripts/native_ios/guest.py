"""Guest-only compile check; this does not execute behavioral UI tests."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import os
import subprocess
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--run', required=True)
    args = parser.parse_args()
    artifacts = args.artifacts
    source = Path.home() / 'arcadia-ci-ios'
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
        subprocess.run(['/usr/bin/tar', '-xzf', str(args.archive), '-C', str(source)], check=True)
        sys.path.insert(0, str(source / 'scripts'))
        sys.path.insert(0, str(source / 'test-environment/native'))
        from native_preview.environment import toolchain
        from native_loop.progress import execute
        from source_archive import guard_source
        facts, env = toolchain()
        (artifacts / 'toolchain.json').write_text(json.dumps(facts, indent=2) + '\n')
        derived = Path.home() / 'arcadia-ci-derived/ios'
        guard_source(source, args.archive, artifacts / 'source-before.json')
        env.update(PATH='/opt/homebrew/opt/ruby@3.4/bin:/opt/homebrew/bin:' + os.environ['PATH'],
                   BUNDLE_GEMFILE=str(source / 'Gemfile'), BUNDLE_PATH=str(Path.home() / '.cache/arcadia-fastlane'),
                   BUNDLE_FROZEN='1', FASTLANE_SKIP_UPDATE_CHECK='1', FASTLANE_OPT_OUT_USAGE='1', FASTLANE_HIDE_CHANGELOG='1')
        command = ['/usr/bin/env', *[key + '=' + env[key] for key in
                   ['DEVELOPER_DIR', 'PATH', 'BUNDLE_GEMFILE', 'BUNDLE_PATH',
                    'BUNDLE_FROZEN', 'FASTLANE_SKIP_UPDATE_CHECK', 'FASTLANE_OPT_OUT_USAGE', 'FASTLANE_HIDE_CHANGELOG']],
                   'bundle', 'exec', 'fastlane', 'ios_compile']
        print('==> iOS app and UI-test bundle compilation', flush=True)
        os.chdir(source)
        status = execute(str(artifacts / 'build.log'), command)
        print('==> Final source integrity verification', flush=True)
        guard_source(source, args.archive, artifacts / 'source-after.json')
        products = derived / 'Build/Products/Debug-iphonesimulator'
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
