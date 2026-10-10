import json
import argparse
from unittest.mock import patch
from pathlib import Path
import struct
import tempfile
import unittest

import dependencies
import progress
import runner
import screenshots


class ImprovementsTests(unittest.TestCase):
    def test_helper_changes_create_immutable_whole_bundles(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            tools = root / 'inputs'
            tools.mkdir()
            (tools / 'guest.sh').write_text('driver')
            helper = tools / 'progress.py'
            helper.write_text('old helper')
            task = runner.Task(argparse.Namespace(root=str(root), task='task'))
            task.directory.mkdir()
            with patch('runner.TOOLS', tools):
                task.sync_tools()
                old = task.directory / 'tools' / task.tools_digest
                helper.write_text('new helper with changed size')
                task.sync_tools()
                new = task.directory / 'tools' / task.tools_digest
            self.assertNotEqual(old, new)
            self.assertEqual((old / 'progress.py').read_text(), 'old helper')
            self.assertEqual((new / 'progress.py').read_text(), 'new helper with changed size')
            self.assertEqual((old / 'guest.sh').read_text(), (new / 'guest.sh').read_text())

    def test_targeted_pass_is_never_recorded_as_a_full_suite(self):
        with tempfile.TemporaryDirectory() as root:
            args = argparse.Namespace(root=root, task='task', only_testing=['ArcadiaUITests/FeedbackLoopTests/testEmpty'])
            task = runner.Task(args)
            task.directory.mkdir()
            task.sync_tools()
            task.manifest = {'runs': [], 'source_sha256': 'source', 'vm': 'owned-vm'}
            with patch('runner.run'):
                task.guest('test')
            record = json.loads(task.path.read_text())['runs'][0]
            self.assertEqual(record['tests'], args.only_testing)
            self.assertFalse(record['full_suite'])
            self.assertEqual(record['status'], 'passed')

    def test_integration_pass_is_not_a_full_suite(self):
        with tempfile.TemporaryDirectory() as root:
            args = argparse.Namespace(root=root, task='task', only_testing=None, integration=True)
            task = runner.Task(args)
            task.directory.mkdir()
            task.sync_tools()
            task.manifest = {'runs': [], 'source_sha256': 'source', 'vm': 'owned-vm'}
            with patch('runner.run'):
                task.guest('test')
            record = json.loads(task.path.read_text())['runs'][0]
            self.assertFalse(record['full_suite'])
            self.assertEqual(record['tests'], ['ArcadiaUITests/FeedbackLoopTests/testIntegrationBrowse'])

    def test_filter_rejects_options_and_unrelated_targets(self):
        runner.validate_test('ArcadiaUITests/FeedbackLoopTests/testEmpty')
        runner.validate_test('ArcadiaTests/AlbumsModelTests')
        for identifier in ['-skip-testing:ArcadiaTests', 'OtherTests/testEmpty', 'ArcadiaUITests/../testEmpty', 'ArcadiaUITests/Class/test;exit']:
            with self.subTest(identifier=identifier), self.assertRaises(runner.LoopError):
                runner.validate_test(identifier)

    def test_cache_publication_keeps_valid_seed_and_repairs_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source, target = root / 'candidate.tgz', root / 'cache/seed.tgz'
            source.write_bytes(b'completed-seed')
            runner.publish_dependency_cache(source, target)
            source.write_bytes(b'new-candidate')
            runner.publish_dependency_cache(source, target)
            self.assertEqual(target.read_bytes(), b'completed-seed')
            target.write_bytes(b'corrupted')
            runner.publish_dependency_cache(source, target)
            self.assertEqual(target.read_bytes(), b'new-candidate')
            self.assertEqual(json.loads(target.with_suffix('.json').read_text())['sha256'], runner.fingerprint(target))

    def test_cache_invalidates_for_dependencies_toolchain_and_project_settings(self):
        key = dependencies.cache_key('image', b'pins', b'project')
        for inputs in [('other-image', b'pins', b'project'), ('image', b'new-pins', b'project'), ('image', b'pins', b'new-settings')]:
            self.assertNotEqual(key, dependencies.cache_key(*inputs))

    def test_dependency_seed_excludes_application_and_test_outputs(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source, target = root / 'derived', root / 'seed'
            files = ['SourcePackages/checkouts/swift-syntax/source.swift', 'Build/Products/Debug/SwiftSyntax.swiftmodule/arm64.swiftmodule', 'Build/Products/Debug/Arcadia.swiftmodule/arm64.swiftmodule', 'Build/Products/Debug/Arcadia.app/executable', 'Build/Products/Debug/ArcadiaTests.xctest/tests', 'Build/Intermediates.noindex/swift-syntax.build/object.o', 'Build/Intermediates.noindex/Arcadia.build/object.o', 'Logs/Test/results', 'Index.noindex/data', 'Build/Intermediates.noindex/ExplicitPrecompiledModules/Foundation.pcm', 'Build/Intermediates.noindex/SwiftExplicitPrecompiledModules/SwiftSyntax.swiftmodule', 'Build/Intermediates.noindex/GeneratedModuleMaps/SwiftSyntax.modulemap']
            for name in files:
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
            dependencies.stage(source, target)
            self.assertTrue((target / files[0]).exists())
            self.assertTrue((target / files[1]).exists())
            self.assertTrue((target / files[5]).exists())
            self.assertTrue((target / files[9]).exists())
            self.assertTrue((target / files[10]).exists())
            self.assertTrue((target / files[11]).exists())
            for name in [files[i] for i in [2, 3, 4, 6, 7, 8]]:
                self.assertFalse((target / name).exists(), name)

    def test_progress_reports_phases_without_raw_log_content(self):
        self.assertEqual(progress.classify('SwiftCompile normal arm64 SwiftSyntax/generated'), 'dependency compilation')
        self.assertEqual(progress.classify('SwiftCompile normal arm64 Arcadia/Albums.swift'), 'app compilation')
        self.assertEqual(progress.classify('Test Suite started'), 'behavioral tests')
        self.assertIsNone(progress.classify('https://host.example/?token=secret'))

    def test_comparison_matches_test_and_enforces_window_size(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            attachments = root / 'artifacts/run/tests-attachments'
            attachments.mkdir(parents=True)
            image = attachments / 'screenshot.png'
            def png(width):
                return b'\x89PNG\r\n\x1a\n' + b'\0\0\0\rIHDR' + struct.pack('>II', width, 450)
            image.write_bytes(png(900))
            item = {'exportedFileName': image.name, 'isAssociatedWithFailure': False, 'suggestedHumanReadableName': 'Empty_0_image.png'}
            (attachments / 'manifest.json').write_text(json.dumps([{'testIdentifier': 'FeedbackLoopTests/testEmpty()', 'attachments': [item]}]))
            selected = 'ArcadiaUITests/FeedbackLoopTests/testEmpty'
            screenshots.capture(root, 'run', 'before', selected)
            image.write_bytes(png(800))
            with self.assertRaisesRegex(ValueError, 'window sizes differ'):
                screenshots.capture(root, 'run', 'after', selected)
            self.assertFalse((root / 'comparison/after.png').exists())
            with self.assertRaisesRegex(ValueError, 'exactly one'):
                screenshots.capture(root, 'run', 'after', 'ArcadiaUITests/FeedbackLoopTests/testSuccess')
            image.write_bytes(png(900))
            screenshots.capture(root, 'run', 'after', selected)
            self.assertIn('![After](after.png)', (root / 'comparison/README.md').read_text())


if __name__ == '__main__':
    unittest.main()
