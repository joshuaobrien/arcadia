"""Cache identity, lifecycle and command routing without running native builds."""
import argparse
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import dependencies
import runner

class MobileCacheTests(unittest.TestCase):
    def task(self, root, platform='iphone'):
        task=runner.Task(argparse.Namespace(root=str(root),task='cache',platform=platform,
            dependency_cache=str(root/'seeds'),no_dependency_cache=False))
        (task.directory/'source').mkdir(parents=True)
        (task.directory/'artifacts').mkdir()
        task.manifest={'image':'immutable-image','runs':[]}
        self.source(task)
        return task

    def source(self, task, pins=b'pins'):
        with tarfile.open(task.directory/'source/source.tgz','w:gz') as archive:
            for name,data in [('Arcadia/Arcadia.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',pins),('Arcadia/Arcadia.xcodeproj/project.pbxproj',b'project')]:
                entry=tarfile.TarInfo(name);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))

    def test_mobile_identity_is_separate_without_invalidating_existing_mac_keys(self):
        import hashlib
        expected=hashlib.sha256(b'\0'.join([dependencies.VERSION.encode(),b'image',b'pins',b'project'])).hexdigest()[:24]
        self.assertEqual(dependencies.cache_key('image',b'pins',b'project'),expected)
        self.assertNotEqual(expected,dependencies.cache_key('image',b'pins',b'project','iphone'))
        with self.assertRaises(ValueError):dependencies.cache_key('image',b'pins',b'project','duo')

    def test_fresh_task_restores_published_mobile_seed_and_keeps_mac_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            task=self.task(Path(tmp));calls=[]
            def guest(operation,*args):
                calls.append((operation,args))
                if operation=='dependency-save':
                    (task.directory/'artifacts/dependency-candidate.tgz').write_bytes(b'private-package-seed')
            with patch.object(task,'guest',side_effect=guest):
                task.prepare_dependencies();self.assertFalse(task.dependency_state()['dependency_cache_hit'])
                task.publish_dependencies()
                mobile_key=task.dependency_state()['dependency_cache_key']
                task.args.platform='mac';task.prepare_dependencies()
                mac_key=task.manifest['dependency_cache_key'];self.assertNotEqual(mac_key,mobile_key)
                task.args.platform='iphone';del task.manifest['mobile_dependency_cache']
                task.prepare_dependencies()
                self.assertTrue(task.dependency_state()['dependency_cache_hit'])
                self.assertEqual(task.manifest['dependency_cache_key'],mac_key)
                self.assertIn(('dependency-restore',('iphone',)),calls)
                self.assertIn(('dependency-save',('iphone',)),calls)
                self.assertNotIn(('dependency-reset',()),calls)
                self.source(task,b'changed-pins');task.prepare_dependencies()
                self.assertIn(('dependency-reset',('iphone',)),calls)

    def test_disabled_mobile_cache_never_restores_or_publishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            task=self.task(Path(tmp));task.manifest['dependency_cache_disabled']=True
            with patch.object(task,'guest') as guest:
                task.prepare_dependencies();task.publish_dependencies();guest.assert_not_called()

    def test_corrupt_mobile_cache_falls_back_to_cold_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            task=self.task(Path(tmp));task.prepare_dependencies()
            cache=Path(task.dependency_state()['dependency_cache']);cache.parent.mkdir()
            cache.write_bytes(b'corrupt');cache.with_suffix('.json').write_text(json.dumps({'sha256':'wrong'}))
            del task.manifest['mobile_dependency_cache']
            with patch.object(task,'guest') as guest:
                task.prepare_dependencies();guest.assert_not_called()
            self.assertFalse(task.dependency_state()['dependency_cache_hit'])

if __name__=='__main__':unittest.main()
