import hashlib
import importlib.machinery
import importlib.util
import json
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
              'head': {'sha': 'head', 'repo': {'full_name': 'jj/arcadia'}}}
        class Server(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def answer(self, body, mime='application/json'):
                self.send_response(200); self.send_header('Content-Type', mime); self.end_headers()
                self.wfile.write(json.dumps(body).encode() if mime == 'application/json' else body)
            def do_GET(self):
                if self.path.endswith('/assets'): self.answer(assets)
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
                for stage in ['before', 'after']:
                    d = Path(temporary) / stage; d.mkdir(); directories.append(d)
                    data = b'\x89PNG\r\n\x1a\n' + stage.encode()
                    (d / 'screenshot.png').write_bytes(data)
                    (d / 'verification.json').write_text(json.dumps({'captured': True, 'platform': 'mac', 'run_id': stage, 'source_sha256': 'a' * 64, 'image_sha256': hashlib.sha256(data).hexdigest()}))
                publisher = module.Publisher('token test-only', 'http://127.0.0.1:' + str(server.server_port))
                publisher.publish(42, [('mac', *directories)])
                body = pr['body']
                publisher.publish(42, [('mac', *directories)])
                self.assertEqual(len(assets), 2)
                self.assertEqual(pr['body'], body)
                self.assertIn('Original description', body)
                self.assertIn('![mac before]', body); self.assertIn('![mac after]', body)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_modified_or_wrong_platform_capture_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'screenshot.png').write_bytes(b'\x89PNG\r\n\x1a\nimage')
            (directory / 'verification.json').write_text(json.dumps({'captured': True, 'platform': 'duo', 'image_sha256': 'wrong'}))
            with self.assertRaises(ValueError): module.read_capture('mac', directory)


if __name__ == '__main__': unittest.main()
