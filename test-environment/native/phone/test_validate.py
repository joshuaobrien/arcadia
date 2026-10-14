"""Host-safe filesystem guard tests; never invokes native tooling."""
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


def driver():
    specification = importlib.util.spec_from_file_location('phone_validate', Path(__file__).with_name('validate.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class StagingTests(unittest.TestCase):
    def test_runner_migration_cleans_owned_copies_but_retains_changed_private_input(self):
        module = driver()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private = root / 'private.json'
            private.write_text('{"password":"disposable"}')
            owner = {'token': 'our-run'}
            staging = module.PrivateStaging(private, owner)
            first, second = root / 'initial', root / 'replacement'
            staging.install(first)
            staging.install(second)
            (second / module.CONFIGURATION).write_text('someone changed this')
            report = staging.cleanup([first, second])
            self.assertFalse((first / module.CONFIGURATION).exists())
            self.assertFalse((first / module.MARKER).exists())
            self.assertEqual((second / module.CONFIGURATION).read_text(), 'someone changed this')
            self.assertTrue((second / module.MARKER).exists())
            self.assertEqual(report['refused_changed_configuration'], [str(second / module.CONFIGURATION)])

    def test_preexisting_configuration_is_never_overwritten_or_claimed(self):
        module = driver()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private = root / 'private.json'
            private.write_text('new')
            documents = root / 'documents'
            documents.mkdir()
            (documents / module.CONFIGURATION).write_text('unrelated')
            with self.assertRaisesRegex(RuntimeError, 'pre-existing'):
                module.PrivateStaging(private, {'token': 'our-run'}).install(documents)
            self.assertEqual((documents / module.CONFIGURATION).read_text(), 'unrelated')
            self.assertFalse((documents / module.MARKER).exists())


class SourceGuardTests(unittest.TestCase):
    def test_changed_file_rejects_snapshot_and_retains_report(self):
        specification = importlib.util.spec_from_file_location('phone_validate', Path(__file__).with_name('validate.py'))
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            (source / 'song.swift').write_text('changed')
            archive = root / 'source.tgz'
            with tarfile.open(archive, 'w:gz') as bundle:
                entry = tarfile.TarInfo('song.swift')
                entry.size = len(b'original')
                bundle.addfile(entry, io.BytesIO(b'original'))
            report = root / 'guard.json'
            with self.assertRaisesRegex(RuntimeError, 'source archive mismatch'):
                module.guard_source(source, archive, report)
            evidence = json.loads(report.read_text())
            self.assertEqual(evidence['mismatches'], ['song.swift'])
            self.assertFalse(evidence['passed'])


if __name__ == '__main__':
    unittest.main()
