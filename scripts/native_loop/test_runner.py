import argparse
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import runner


class OwnershipTests(unittest.TestCase):
    def test_changed_driver_keeps_old_and_new_guest_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tools = root / 'tools'
            tools.mkdir()
            driver = tools / 'guest.sh'
            driver.write_text('old driver')
            task = runner.Task(argparse.Namespace(root=str(root), task='task'))
            task.directory.mkdir()
            with patch('runner.TOOLS', tools):
                task.sync_tools()
                old = task.directory / 'tools' / ('guest-' + runner.fingerprint(driver) + '.sh')
                driver.write_text('new driver with a different size')
                task.sync_tools()
                new = task.directory / 'tools' / ('guest-' + runner.fingerprint(driver) + '.sh')
            self.assertEqual(old.read_text(), 'old driver')
            self.assertEqual(new.read_text(), 'new driver with a different size')

    def test_iteration_review_exports_images_and_logs_without_bulk_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            task = runner.Task(argparse.Namespace(root=temporary, task='task', operation='test'))
            artifacts = task.directory / 'artifacts'
            artifacts.mkdir(parents=True)
            (artifacts / 'test.log').write_text('passed')
            (artifacts / 'app.png').write_bytes(b'png')
            (artifacts / 'recording.mp4').write_bytes(b'video')
            result = artifacts / 'tests.xcresult'
            result.mkdir()
            (result / 'results').write_bytes(b'full results')
            task.manifest = {'state': 'finished'}
            task.export()
            with tarfile.open(task.directory / 'review.tgz') as archive:
                names = archive.getnames()
            self.assertIn('artifacts/app.png', names)
            self.assertIn('artifacts/test.log', names)
            self.assertNotIn('artifacts/recording.mp4', names)
            self.assertNotIn('artifacts/tests.xcresult', names)
            self.assertTrue((result / 'results').exists())

    def test_mint_cache_tracks_tool_version_and_guest_image(self):
        key = runner.mint_cache_key('image-a', b'lint@1')
        self.assertEqual(key, runner.mint_cache_key('image-a', b'lint@1'))
        self.assertNotEqual(key, runner.mint_cache_key('image-b', b'lint@1'))
        self.assertNotEqual(key, runner.mint_cache_key('image-a', b'lint@2'))

    def test_published_mint_cache_is_independent_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'task'
            source.mkdir()
            (source / 'tool').write_text('compiled')
            target = Path(temporary) / 'persistent/cache'
            runner.publish_mint_cache(source, target)
            (source / 'tool').write_text('changed')
            runner.publish_mint_cache(source, target)
            self.assertEqual((target / 'tool').read_text(), 'compiled')

    def test_task_names_cannot_escape_root(self):
        for task in ['../other', '/tmp/other', '-other', 'UPPER', 'a' * 41]:
            with self.subTest(task=task), self.assertRaises(runner.LoopError):
                runner.validate_task(task)

    def test_manifest_cannot_target_an_unrelated_vm(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'task'
            directory.mkdir()
            (directory / 'manifest.json').write_text(json.dumps({'owner': runner.OWNER, 'task': 'task', 'vm': 'production'}))
            with self.assertRaises(runner.LoopError):
                runner.owned_manifest(directory)

    def test_archive_rejects_traversal_and_links(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            for name, kind in [('../outside', tarfile.REGTYPE), ('link', tarfile.SYMTYPE)]:
                archive_path = root / 'source.tar'
                with tarfile.open(archive_path, 'w') as archive:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    entry.linkname = '/etc/passwd'
                    archive.addfile(entry)
                with tarfile.open(archive_path) as archive, self.assertRaises(runner.LoopError):
                    runner.safe_extract(archive, root / 'output')

    def test_failed_export_prevents_destruction(self):
        args = argparse.Namespace(root='/tmp/example', task='task')
        task = runner.Task(args)
        task.manifest = {'state': 'ready', 'vm': 'arcadia-loop-task-1234abcd'}
        with patch.object(task, 'export', side_effect=runner.LoopError('export failed')), patch('runner.run') as command:
            with self.assertRaises(runner.LoopError):
                task.finish()
            command.assert_not_called()

    def test_finish_exports_before_and_after_teardown(self):
        args = argparse.Namespace(root='/tmp/example', task='task')
        task = runner.Task(args)
        task.manifest = {'state': 'ready', 'vm': 'arcadia-loop-task-1234abcd'}
        events = []
        with patch.object(task, 'export', side_effect=lambda: events.append('export')), patch.object(task, 'save'), patch('runner.run', side_effect=lambda c, **kw: (events.append(c[1]), SimpleNamespace(stdout=json.dumps([{'Name': task.manifest['vm'], 'Source': 'local', 'Running': True}])))[1]):
            task.finish()
        self.assertEqual(events, ['export', 'list', 'stop', 'delete', 'export'])
        self.assertEqual(task.manifest['state'], 'finished')


if __name__ == '__main__':
    unittest.main()
