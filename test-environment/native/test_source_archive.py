"""Real filesystem/archive checks through both validation entrypoints; no native tools."""
import importlib.util
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parent


class SourceArchiveTests(unittest.TestCase):
    def check_driver(self, driver, members, files, passed):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repository = root / 'repository'
            target = repository / 'test-environment/native' / driver
            target.mkdir(parents=True)
            # Exercise the checked-in driver at its normal repository-relative path.
            shutil.copy(NATIVE / driver / 'validate.py', target / 'validate.py')
            for helper in NATIVE.glob('source_archive.py'):
                shutil.copy(helper, target.parent / helper.name)
            for name, content in files.items():
                path = repository / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            archive = root / 'source.tar'
            with tarfile.open(archive, 'w') as stream:
                for name, content in members:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(content)
                    stream.addfile(entry, io.BytesIO(content))
            report = root / 'report.json'
            if driver == 'phone':
                sys.modules.pop('source_archive', None)
                specification = importlib.util.spec_from_file_location('phone_archive_test', target / 'validate.py')
                module = importlib.util.module_from_spec(specification)
                specification.loader.exec_module(module)
                try:
                    module.guard_source(repository, archive, report)
                except RuntimeError:
                    self.assertFalse(passed)
                else:
                    self.assertTrue(passed)
            else:
                output = root / 'output'
                # The source guard must finish before any native inventory command.
                environment = dict(os.environ, PATH='')
                subprocess.run([os.sys.executable, str(target / 'validate.py'), 'fixture',
                                '--device', 'owned', '--output', str(output),
                                '--derived-data', str(root / 'derived'), '--source-archive', str(archive),
                                '--control', str(root / 'control')], env=environment,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                report = output / 'source-before.json'
            if report.exists():
                result = json.loads(report.read_text())
                self.assertEqual(result['passed'], passed)
                if passed:
                    self.assertEqual(len(result['source_guard_sha256']), 64)
                if passed:
                    self.assertEqual(result['checked_files'], 1)
                    self.assertEqual(result['mismatches'], [])
            else:
                self.assertFalse(passed)

    def test_empty_archive_is_rejected_by_both_drivers(self):
        for driver in ('phone', 'duo'):
            with self.subTest(driver=driver):
                self.check_driver(driver, [], {}, False)

    def test_escaping_member_is_rejected_even_when_external_bytes_match(self):
        for driver in ('phone', 'duo'):
            with self.subTest(driver=driver):
                self.check_driver(driver, [('../outside', b'outside')], {'../outside': b'outside'}, False)

    def test_changed_source_is_rejected_by_both_drivers(self):
        for driver in ('phone', 'duo'):
            with self.subTest(driver=driver):
                self.check_driver(driver, [('source.swift', b'original')], {'source.swift': b'changed'}, False)

    def test_matching_source_preserves_success_report_for_both_drivers(self):
        for driver in ('phone', 'duo'):
            with self.subTest(driver=driver):
                self.check_driver(driver, [('source.swift', b'original')], {'source.swift': b'original'}, True)


if __name__ == '__main__':
    unittest.main()
