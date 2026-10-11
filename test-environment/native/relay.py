#!/usr/bin/env python3
"""Expose only a task's loopback fixture on the VM-host interface."""
import argparse
import os
import select
import socket
import socketserver
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--root',required=True)
parser.add_argument('--bind',required=True)
parser.add_argument('--port',type=int,default=18097)
parser.add_argument('--upstream-port',type=int,default=18096)
args=parser.parse_args()
root=Path(args.root)
(root/'relay.pid').write_text(str(os.getpid()))

class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        with socket.create_connection(('127.0.0.1',args.upstream_port),timeout=15) as upstream:
            sockets=[self.request,upstream]
            while True:
                readable,_,_=select.select(sockets,[],[],30)
                if not readable:return
                for source in readable:
                    payload=source.recv(65536)
                    if not payload:return
                    target=upstream if source is self.request else self.request
                    target.sendall(payload)

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True

with Server((args.bind,args.port),Relay) as server:
    server.serve_forever()
