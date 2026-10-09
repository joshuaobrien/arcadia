"""Disposable four-service fixture, private guest route, task-only teardown."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import uuid
import signal
import subprocess
import tarfile
import time
import urllib.request

from runner import LoopError, available_port, atomic_json, run, safe_extract


def compose(directory, config, *arguments, timeout=900):
    return run(['docker', 'compose', '-p', config['project'], '-f', str(directory / 'integration/test-environment/compose.yaml'), *arguments], timeout=timeout, cwd=directory / 'integration')


def probe(base):
    with urllib.request.urlopen(base + '/api/health', timeout=10) as response:
        if response.status != 200:
            raise LoopError('Fixture API is not healthy')
    with urllib.request.urlopen(base + '/api/library/albums?limit=1&fresh=true', timeout=10) as response:
        page = json.load(response)
    if not page.get('configured') or not page.get('mounted') or page['total'] != 1:
        raise LoopError('Disposable library must contain exactly the seeded album')
    album = page['items'][0]
    with urllib.request.urlopen(base + '/api/library/albums/' + album['id'] + '/tracks', timeout=10) as response:
        tracks = json.load(response)
    if tracks['total'] != 3 or tracks['items'][0]['title'] != 'First Contact':
        raise LoopError('Disposable tracks do not match the seed')
    with urllib.request.urlopen(base + album['artworkPath'], timeout=10) as response:
        if not response.headers.get_content_type().startswith('image/'):
            raise LoopError('Fixture artwork is not an image')
    return {'album_count': page['total'], 'track_count': tracks['total'], 'artwork': True}


def stop(directory, config):
    if not re.fullmatch(r'arcadia-loop-[a-z0-9-]+-[0-9a-f]{8}', config.get('project', '')):
        raise LoopError('Invalid integration ownership; refusing teardown')
    pid = config.get('relay_pid')
    if pid:
        command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
        key = str(directory / 'integration-key')
        if key in command and 'ssh' in command:
            os.kill(pid, signal.SIGTERM)
    compose(directory, config, 'down', '--volumes', '--remove-orphans', timeout=180)
    for name in ['integration-key', 'integration-key.pub', 'integration-known-hosts']:
        (directory / name).unlink(missing_ok=True)
    config['state'] = 'stopped'
    atomic_json(directory / 'integration.json', config)


def start(directory, manifest, tart, source_archive):
    if (directory / 'integration.json').exists():
        existing = json.loads((directory / 'integration.json').read_text())
        if existing['state'] == 'ready':
            return existing
        if existing['project'] != manifest['vm'] or existing['state'] != 'stopped':
            raise LoopError('Integration ownership or state mismatch; refusing replacement')
        shutil.rmtree(directory / 'integration')
        previous_log = directory / 'artifacts/integration.log'
        if previous_log.exists():
            previous_log.rename(previous_log.with_name('integration-failure-' + uuid.uuid4().hex[:8] + '.log'))
    if not source_archive:
        raise LoopError('Integration requires an explicit disposable source archive')
    fixture = directory / 'integration'
    fixture.mkdir(mode=0o700)
    with tarfile.open(source_archive) as archive:
        safe_extract(archive, fixture)
    Path(source_archive).unlink()
    config = {'project': manifest['vm'], 'state': 'starting', 'ports': {name: available_port() for name in ['api', 'slskd', 'soulseek', 'beets', 'jellyfin']}}
    atomic_json(directory / 'integration.json', config)
    stack = fixture / 'test-environment'
    template = (stack / 'compose.yaml').read_text()
    replacements = {'name: arcadia-test': 'name: ' + config['project'],
                    '127.0.0.1:5030:5030': f'127.0.0.1:{config["ports"]["slskd"]}:5030',
                    '127.0.0.1:50300:50300': f'127.0.0.1:{config["ports"]["soulseek"]}:50300',
                    '127.0.0.1:5001:5001': f'127.0.0.1:{config["ports"]["beets"]}:5001',
                    '127.0.0.1:8096:8096': f'127.0.0.1:{config["ports"]["jellyfin"]}:8096',
                    '127.0.0.1:${PORT:-8787}:8787': f'127.0.0.1:{config["ports"]["api"]}:8787',
                    'restart: unless-stopped': 'restart: "no"'}
    for before, after in replacements.items():
        if before not in template:
            raise LoopError('Compose template changed; refusing unsafe port/state adaptation')
        template = template.replace(before, after)
    (stack / 'compose.yaml').write_text(template)
    # The existing bootstrap runs inside the disposable Compose network, not against host services.
    bootstrap = stack / 'bin/bootstrap.mjs'
    bootstrap.write_text(bootstrap.read_text().replace("'http://127.0.0.1:8096'", "'http://jellyfin:8096'"))
    log_path = directory / 'artifacts/integration.log'
    try:
        run(['docker', 'info'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run(['bash', str(stack / 'bin/prepare')], timeout=120)
        # Container-owned state permissions apply only beneath this private disposable task directory.
        run(['docker', 'run', '--rm', '-v', str(stack / 'state') + ':/state', 'alpine:3.21', 'chown', '-R', '1000:1000', '/state'], timeout=180)
        with log_path.open('w') as log:
            compose(directory, config, 'up', '-d', 'slskd', 'beets-flask', 'jellyfin')
            run(['docker', 'run', '--rm', '--network', config['project'] + '_default', '-v', str(stack) + ':/fixture',
                 'node:24-alpine', 'node', '/fixture/bin/bootstrap.mjs'], timeout=240, stdout=log, stderr=subprocess.STDOUT)
            compose(directory, config, 'up', '-d', '--build', 'arcadia')
        host_url = f'http://127.0.0.1:{config["ports"]["api"]}'
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                config['probe'] = probe(host_url)
                break
            except Exception:
                time.sleep(2)
        else:
            raise LoopError('Disposable fixture browse/artwork failed readiness within 120s')
        key = directory / 'integration-key'
        run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key), '-C', manifest['vm']])
        public = key.with_suffix('.pub').read_text().strip()
        install = "import pathlib,sys; p=pathlib.Path.home()/'.ssh'; p.mkdir(mode=0o700,exist_ok=True); a=p/'authorized_keys'; a.write_text((a.read_text() if a.exists() else '')+sys.argv[1]+'\\n'); a.chmod(0o600)"
        run([tart, 'exec', manifest['vm'], '/usr/bin/python3', '-c', install, public])
        host_key = run([tart, 'exec', manifest['vm'], '/bin/cat', '/etc/ssh/ssh_host_ed25519_key.pub'], capture_output=True, text=True).stdout.strip()
        ip = run([tart, 'ip', manifest['vm']], capture_output=True, text=True).stdout.strip()
        known_hosts = directory / 'integration-known-hosts'
        known_hosts.write_text(ip + ' ' + host_key + '\n')
        # Reserve a guest-local port; no host network interface is exposed to the guest.
        guest_port = int(run([tart, 'exec', manifest['vm'], '/usr/bin/python3', '-c',
            "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1])"], capture_output=True, text=True).stdout.strip())
        with (directory / 'integration-relay.log').open('w') as log:
            relay = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
                '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(known_hosts),
                '-i', str(key), '-N', '-R', f'127.0.0.1:{guest_port}:127.0.0.1:{config["ports"]["api"]}', 'admin@' + ip],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        config['relay_pid'] = relay.pid
        config['guest_url'] = f'http://localhost:{guest_port}'
        atomic_json(directory / 'integration.json', config)
        check = "import urllib.request,sys; r=urllib.request.urlopen(sys.argv[1]+'/api/library/albums?limit=1',timeout=5); print(r.status)"
        for _ in range(10):
            result = subprocess.run([tart, 'exec', manifest['vm'], '/usr/bin/python3', '-c', check, config['guest_url']], capture_output=True, timeout=15)
            if result.returncode == 0:
                break
            time.sleep(1)
        else:
            raise LoopError('Private guest API route did not become ready')
        config['state'] = 'ready'
        atomic_json(directory / 'integration.json', config)
        print(json.dumps({'integration': 'ready', 'guest_url': config['guest_url'], 'probe': config['probe']}), flush=True)
        return config
    except Exception:
        with log_path.open('a') as log:
            subprocess.run(['docker', 'compose', '-p', config['project'], '-f', str(stack / 'compose.yaml'), 'logs', '--no-color'], stdout=log, stderr=subprocess.STDOUT, timeout=30)
        stop(directory, config)
        raise
