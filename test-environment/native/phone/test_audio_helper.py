"""Filesystem/compiler-boundary checks; never builds or launches a native app."""
from contextlib import contextmanager
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def load_driver():
    specification = importlib.util.spec_from_file_location('audio_helper', Path(__file__).with_name('audio_helper.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


@contextmanager
def capture_build_fixture():
    module = load_driver()
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        source, plist = root / 'capture.swift', root / 'capture.plist'
        source.write_text('capture source A')
        plist.write_text('capture plist A')
        toolchain = {'compiler': '/selected/swiftc', 'compiler_version': 'Swift A',
                     'compiler_sha256': 'compiler A', 'sdk': '/selected/SDK',
                     'sdk_version': '27.0', 'sdk_build': 'SDK A', 'architecture': 'arm64'}
        compiled = []

        def native_command(command, **kwargs):
            if command[0] == '/selected/swiftc':
                compiled.append(command)
                Path(command[command.index('-o') + 1]).write_bytes(b'freshly built capture helper')

        with patch.object(module, 'SOURCE', source), patch.object(module, 'PLIST', plist), \
                patch.object(module, 'discover_toolchain', side_effect=lambda: dict(toolchain)), \
                patch('subprocess.run', side_effect=native_command):
            yield module, root, source, plist, toolchain, compiled


class AudioHelperTests(unittest.TestCase):
    def test_fresh_source_builds_a_valid_bundle_and_unchanged_cache_avoids_recompiling(self):
        with capture_build_fixture() as (module, root, source, plist, toolchain, compiled):
            first = module.build_helper(root / 'cache')
            second = module.build_helper(root / 'cache')
            evidence = module.validate_helper(Path(first['binary']), Path(first['manifest']))
            self.assertEqual(first['binary'], second['binary'])
            self.assertEqual(len(compiled), 1)
            self.assertTrue(evidence['verified'])
            manifest = json.loads(Path(first['manifest']).read_text())
            self.assertEqual(manifest['binary_sha256'], evidence['binary_sha256'])
            self.assertEqual(Path(first['binary']).parent.parent.joinpath('Info.plist').read_text(), 'capture plist A')

    def test_changed_source_rejects_old_provenance_and_builds_a_separate_cache_entry(self):
        with capture_build_fixture() as (module, root, source, plist, toolchain, compiled):
            old = module.build_helper(root / 'cache')
            source.write_text('capture source B')
            with self.assertRaisesRegex(ValueError, 'current source/plist/toolchain'):
                module.validate_helper(old['binary'], old['manifest'])
            fresh = module.build_helper(root / 'cache')
            self.assertNotEqual(fresh['binary'], old['binary'])
            self.assertEqual(len(compiled), 2)
            self.assertTrue(Path(old['binary']).exists())

    def test_changed_toolchain_rejects_old_provenance_and_builds_a_separate_cache_entry(self):
        with capture_build_fixture() as (module, root, source, plist, toolchain, compiled):
            old = module.build_helper(root / 'cache')
            toolchain['sdk_build'] = 'SDK B'
            with self.assertRaisesRegex(ValueError, 'current source/plist/toolchain'):
                module.validate_helper(old['binary'], old['manifest'])
            fresh = module.build_helper(root / 'cache')
            self.assertNotEqual(fresh['binary'], old['binary'])
            self.assertEqual(len(compiled), 2)

    def test_changed_plist_rejects_stale_provenance_and_uses_a_new_cache_entry(self):
        with capture_build_fixture() as (module, root, source, plist, toolchain, compiled):
            old = module.build_helper(root / 'cache')
            plist.write_text('capture plist B')
            with self.assertRaisesRegex(ValueError, 'current source/plist/toolchain'):
                module.validate_helper(old['binary'], old['manifest'])
            fresh = module.build_helper(root / 'cache')
            self.assertNotEqual(fresh['binary'], old['binary'])
            self.assertEqual(Path(fresh['binary']).parent.parent.joinpath('Info.plist').read_text(), 'capture plist B')

    def test_tampered_binary_is_rejected_without_rebuilding_or_discarding_evidence(self):
        with capture_build_fixture() as (module, root, source, plist, toolchain, compiled):
            built = module.build_helper(root / 'cache')
            binary = Path(built['binary'])
            binary.write_bytes(b'tampered output')
            with self.assertRaisesRegex(ValueError, 'binary or bundle plist'):
                module.validate_helper(binary, built['manifest'])
            with self.assertRaises(ValueError):
                module.build_helper(root / 'cache')
            self.assertEqual(len(compiled), 1)
            self.assertEqual(binary.read_bytes(), b'tampered output')

    def test_a_manifest_copied_from_elsewhere_is_not_accepted_as_bundle_provenance(self):
        with capture_build_fixture() as (module, root, source, plist, toolchain, compiled):
            built = module.build_helper(root / 'cache')
            arbitrary_manifest = root / 'assertions.json'
            arbitrary_manifest.write_bytes(Path(built['manifest']).read_bytes())
            with self.assertRaisesRegex(ValueError, 'content-keyed bundle entry'):
                module.validate_helper(built['binary'], arbitrary_manifest)


if __name__ == '__main__':
    unittest.main()
