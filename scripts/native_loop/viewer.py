"""Noninteractive viewer configuration for an owned official-image task only."""
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys

OFFICIAL_IMAGE = 'ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:61f6e857a3d65dd2f8daf9c51c7b837fa458bcc9181ae8556e645b534dab6bf6'


def connection(path):
    config = json.loads(Path(path).read_text())
    task = config.get('task', '')
    port = config.get('port')
    host = config.get('host', '')
    if (config.get('owner') != 'arcadia-native-loop-v1'
            or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', task)
            or config.get('image') != OFFICIAL_IMAGE
            or not re.fullmatch(r'arcadia-loop-' + re.escape(task) + r'-[0-9a-f]{8}', config.get('vm', ''))
            or not isinstance(port, int) or not 1024 <= port <= 65535
            or not re.fullmatch(r'[A-Za-z0-9_.@-]+', host) or host.startswith('-')):
        raise ValueError('Viewer requires an owned task using the pinned official image')
    forward = config.get('forward', '')
    if not re.fullmatch(r'127\.0\.0\.1:' + str(port) + r':(?:\d{1,3}\.){3}\d{1,3}:5900', forward):
        raise ValueError('Viewer requires the task loopback SSH tunnel')
    command = subprocess.run(['ps', '-p', str(int(config['pid'])), '-o', 'command='],
                             capture_output=True, text=True, check=True).stdout
    if forward not in command or host not in command or 'ssh' not in command:
        raise ValueError('Task viewer tunnel is no longer running')
    with socket.create_connection(('127.0.0.1', port), timeout=3) as stream:
        if not stream.recv(12).startswith(b'RFB '):
            raise ValueError('Task viewer tunnel did not respond')
    return config


def launch(config_path, binary):
    config = connection(config_path)
    environment = os.environ.copy()
    # Public credentials of this exact disposable image, never user credentials.
    environment.update(VNC_USERNAME='admin', VNC_PASSWORD='admin')
    arguments = [str(binary), '-ReconnectOnError=0', '-AlertOnFatalError=0',
                 '-AcceptClipboard=0', '-SendClipboard=0', '-RemoteResize=0',
                 '-NoJPEG', f"127.0.0.1::{config['port']}"]
    os.execve(str(binary), arguments, environment)


if __name__ == '__main__':
    try:
        launch(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        # No modal fallback or credential dialog if the task/tunnel has ended.
        sys.exit(1)
