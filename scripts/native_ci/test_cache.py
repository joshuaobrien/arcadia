"""Build-cache behavior through its command interface."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CLI = Path(__file__).resolve().parents[1] / 'ci-build-cache'


class BuildCache(unittest.TestCase):
    def test_reuses_dependencies_but_never_prior_app_or_test_products(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            derived, shared, restored = [root / n for n in ['derived', 'shared', 'restored']]
            shared.mkdir()
            for name in ['Mockable.framework/data', 'Arcadia.app/old', 'ArcadiaTests.xctest/old']:
                p = derived / 'Build/Products/Debug' / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('compiled')
            for operation, directory in [('publish', derived), ('restore', restored)]:
                result = subprocess.run([sys.executable, str(CLI), operation, '--derived', str(directory),
                                         '--shared', str(shared), '--name', 'debug'],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((restored / 'Build/Products/Debug/Mockable.framework/data').read_text(), 'compiled')
            self.assertFalse((restored / 'Build/Products/Debug/Arcadia.app').exists())
            self.assertFalse((restored / 'Build/Products/Debug/ArcadiaTests.xctest').exists())
