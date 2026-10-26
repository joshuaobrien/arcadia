import hashlib
import importlib.machinery
import importlib.util
import json
import io
import tarfile
import subprocess
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = Path(__file__).parent
loader = importlib.machinery.SourceFileLoader('pr_screenshots', str(HERE / 'pr-screenshots'))
spec = importlib.util.spec_from_loader('pr_screenshots', loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)


class Publication(unittest.TestCase):
    def test_upload_is_idempotent_and_images_are_embedded_and_verified(self):
        assets = []
        content = {}
        pr = {'body': 'Original description', 'user': {'login': 'arcadia-pilot-bot'},
              'merge_base': 'before', 'head': {'sha': 'head', 'repo': {'full_name': 'jj/arcadia'}}}
        expected = {}
        class Server(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def answer(self, body, mime='application/json'):
                self.send_response(200); self.send_header('Content-Type', mime); self.end_headers()
                self.wfile.write(json.dumps(body).encode() if mime == 'application/json' else body)
            def do_GET(self):
                if '/git/trees/' in self.path:
                    ref = self.path.split('/git/trees/')[1]
                    stage = 'after' if ref in {'head', 'native-after', 'project-after'} else 'before'
                    if ref in {'head', 'before'}: rows = [{'path': 'Arcadia', 'sha': 'native-' + stage}]
                    elif ref.startswith('native-'): rows = [{'path': 'Arcadia', 'sha': expected[stage]['app_tree_sha']}, {'path': 'Arcadia.xcodeproj', 'sha': 'project-' + stage}]
                    else: rows = [{'path': 'project.pbxproj', 'sha': expected[stage]['project_sha']}]
                    self.answer({'tree': rows, 'truncated': False})
                elif '/commits?' in self.path: self.answer([])
                elif self.path.endswith('/assets'): self.answer(assets)
                elif '/api/' in self.path: self.answer(pr)
                elif self.path.startswith('/attachments/'): self.answer(content[self.path], 'image/png')
                else:
                    evidence = json.loads(pr['body'].split('<!-- arcadia-visual-evidence:v1\n')[1].split('\n-->')[0])
                    html = ''.join(f'<img alt="mac {stage}" src="{pair[stage]["url"]}">' for pair in evidence['pairs'] for stage in ['before', 'after'])
                    self.answer(html.encode(), 'text/html')
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                image = body.split(b'\r\n\r\n', 1)[1].rsplit(b'\r\n--', 1)[0]
                name = self.path.split('?name=')[1]
                ident = str(len(assets) + 1)
                asset = {'id': len(assets) + 1, 'name': name, 'uuid': '00000000-0000-0000-0000-' + ident.zfill(12)}
                assets.append(asset); content['/attachments/' + asset['uuid']] = image; self.answer(asset)
            def do_PATCH(self):
                pr.update(json.loads(self.rfile.read(int(self.headers['Content-Length'])))); self.answer(pr)
        server = HTTPServer(('127.0.0.1', 0), Server)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                directories = []
                source = Path(temporary) / 'source'; source.mkdir()
                for stage in ['before', 'after']:
                    d = Path(temporary) / 'artifacts' / stage; d.mkdir(parents=True); directories.append(d)
                    data = b'\x89PNG\r\n\x1a\n' + stage.encode()
                    (d / 'screenshot.png').write_bytes(data)
                    raw = io.BytesIO()
                    with tarfile.open(fileobj=raw, mode='w:gz') as archive:
                        for name, fixture_content in [('Arcadia/Arcadia/View.swift', stage.encode()), ('Arcadia/Arcadia.xcodeproj/project.pbxproj', b'project')]:
                            item = tarfile.TarInfo(name); item.size = len(fixture_content); item.mode = 0o644
                            archive.addfile(item, io.BytesIO(fixture_content))
                    archive_sha = hashlib.sha256(raw.getvalue()).hexdigest()
                    archive_path = source / ('source-' + archive_sha + '.tgz'); archive_path.write_bytes(raw.getvalue())
                    expected[stage] = module.source_trees(archive_path)
                    (d / 'verification.json').write_text(json.dumps({'captured': True, 'platform': 'mac', 'run_id': stage, 'source_sha256': archive_sha, 'image_sha256': hashlib.sha256(data).hexdigest()}))
                publisher = module.Publisher('token test-only', 'http://127.0.0.1:' + str(server.server_port))
                publisher.publish(42, [('mac', *directories)])
                body = pr['body']
                publisher.publish(42, [('mac', *directories)])
                self.assertEqual(len(assets), 2)
                self.assertEqual(pr['body'], body)
                self.assertIn('Original description', body)
                self.assertIn('![mac before]', body); self.assertIn('![mac after]', body)
                # An old capture cannot acquire a new-head label on republish.
                expected['after'] = dict(expected['after'], app_tree_sha='new-source-tree')
                with self.assertRaisesRegex(ValueError, 'capture does not match'):
                    publisher.publish(42, [('mac', *directories)])
                self.assertEqual(pr['body'], body)
                self.assertEqual(len(assets), 2)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_archive_fingerprint_matches_first_party_git_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = {'Arcadia/Arcadia/View.swift': b'view', 'Arcadia/Arcadia/Nested/Color.swift': b'color',
                     'Arcadia/Arcadia.xcodeproj/project.pbxproj': b'project'}
            archive_path = root / 'source.tgz'
            with tarfile.open(archive_path, 'w:gz') as archive:
                for name, content in files.items():
                    path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
                    item = tarfile.TarInfo(name); item.size = len(content); item.mode = 0o644
                    archive.addfile(item, io.BytesIO(content))
            run = lambda *args: subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
            run('init', '--quiet'); run('add', 'Arcadia')
            expected = {'app_tree_sha': run('write-tree', '--prefix=Arcadia/Arcadia/'),
                        'project_sha': run('hash-object', 'Arcadia/Arcadia.xcodeproj/project.pbxproj')}
            self.assertEqual(module.source_trees(archive_path), expected)

    def test_modified_or_wrong_platform_capture_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'screenshot.png').write_bytes(b'\x89PNG\r\n\x1a\nimage')
            (directory / 'verification.json').write_text(json.dumps({'captured': True, 'platform': 'duo', 'image_sha256': 'wrong'}))
            with self.assertRaises(ValueError): module.read_capture('mac', directory)


if __name__ == '__main__': unittest.main()
