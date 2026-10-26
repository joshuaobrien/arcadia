#!/usr/bin/env python3
"""Sign a private macOS release; all build/identity work stays in the disposable VM."""
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import secrets
import ssl
import subprocess
import sys
import tempfile

IDENTITY = '75E8FFD5ED95862F752087ABD9B0EADF054147F4'


def command(label, *args):
    # Never surface command arguments: security import includes a private P12 password.
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    except subprocess.TimeoutExpired:
        raise RuntimeError(label + ' timed out') from None
    if result.returncode:
        if args[0] == 'codesign':
            print(result.stderr.decode(errors='replace'), file=sys.stderr)
        raise RuntimeError(label + ' failed (' + str(result.returncode) + ')')
    return result.stdout


def sign(app, configuration=None):
    app = Path(app).resolve()
    with tempfile.TemporaryDirectory(prefix='arcadia-release-signing-') as temporary:
        private = Path(temporary)
        keychain = None
        identity = '-'
        search_list = None
        try:
            if configuration:
                config = json.loads(Path(configuration).read_text())
                model = command('Verify disposable VM', 'sysctl', '-n', 'hw.model').decode().strip()
                if not model.startswith('VirtualMac'):
                    raise RuntimeError('Private signing trust is restricted to disposable VMs')
                certificate = (Path(__file__).parent / 'PrivateUpdates.crt').read_text()
                digest = hashlib.sha1(ssl.PEM_cert_to_DER_cert(certificate)).hexdigest().upper()
                if digest != IDENTITY or config['identity'] != IDENTITY:
                    raise RuntimeError('Unexpected private update signing certificate')
                p12 = private / 'identity.p12'
                p12.write_bytes(base64.b64decode(config['pkcs12'], validate=True)); p12.chmod(0o600)
                cert = private / 'identity.crt'; cert.write_text(certificate)
                keychain = private / 'signing.keychain-db'
                password = secrets.token_urlsafe(32)
                command('Create signing keychain', 'security', 'create-keychain', '-p', password, str(keychain))
                command('Unlock signing keychain', 'security', 'unlock-keychain', '-p', password, str(keychain))
                command('Import signing identity', 'security', 'import', str(p12), '-k', str(keychain), '-P', config['password'], '-T', '/usr/bin/codesign')
                search_list = [line.strip().strip(chr(34)) for line in command('Read keychain search list', 'security', 'list-keychains', '-d', 'user').decode().splitlines() if line.strip()]
                command('Add private signing keychain', 'security', 'list-keychains', '-d', 'user', '-s', str(keychain), *search_list)
                command('Allow codesign access', 'security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, str(keychain))
                # Only the pinned certificate, only code signing, only this disposable guest.
                command('Trust private build certificate', 'sudo', '-n', 'security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-p', 'codeSign', '-k', '/Library/Keychains/System.keychain', str(cert))
                identity = IDENTITY
            options = ['--force', '--sign', identity, '--timestamp=none']
            if keychain:
                options += ['--keychain', str(keychain)]
            sparkle = app / 'Contents/Frameworks/Sparkle.framework'
            for nested in ['Versions/B/XPCServices/Installer.xpc', 'Versions/B/XPCServices/Downloader.xpc', 'Versions/B/Autoupdate', 'Versions/B/Updater.app']:
                command('Sign Sparkle helper', 'codesign', *options, '--options', 'runtime', '--preserve-metadata=entitlements', str(sparkle / nested))
            command('Sign Sparkle framework', 'codesign', *options, str(sparkle))
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            template = Path(__file__).parent / 'Arcadia/Arcadia.entitlements'
            entitlements = private / 'app.entitlements'
            entitlements.write_text(template.read_text().replace('$(PRODUCT_BUNDLE_IDENTIFIER)', info['CFBundleIdentifier']))
            command('Sign Arcadia', 'codesign', *options, '--entitlements', str(entitlements), str(app))
            command('Verify signed release', 'codesign', '--verify', '--deep', '--strict', str(app))
            print('Release signature verified: ' + ('stable private identity' if configuration else 'ad-hoc development artifact'))
        finally:
            original_failure = sys.exc_info()[0] is not None
            cleanup_errors = []
            for label, arguments in [
                ('Restore keychain search list', ['security', 'list-keychains', '-d', 'user', '-s', *(search_list or [])] if search_list is not None else None),
                ('Remove private signing keychain', ['security', 'delete-keychain', str(keychain)] if keychain else None),
            ]:
                if arguments:
                    try:
                        command(label, *arguments)
                    except (OSError, RuntimeError) as error:
                        cleanup_errors.append(str(error))
            if cleanup_errors:
                message = '; '.join(cleanup_errors)
                if original_failure:
                    print(message, file=sys.stderr)
                else:
                    raise RuntimeError(message)



if __name__ == '__main__':
    try:
        sign(sys.argv[1], os.environ.get('ARCADIA_SIGNING_FILE'))
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
