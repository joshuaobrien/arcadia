"""Mobile selections cannot silently run Mac/default/live tests."""
import os
from pathlib import Path
import subprocess
import sys
import unittest

import runner


class MobileSelectionTests(unittest.TestCase):
    def rejected(self, *arguments):
        environment = dict(os.environ)
        environment.pop('NATIVE_LOOP_HOST', None)
        result = subprocess.run([sys.executable, str(Path(runner.__file__)),
                                 'test', 'example', *arguments], env=environment,
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        return result.stderr

    def test_mobile_requires_explicit_selection(self):
        self.assertIn('explicit fixture', self.rejected('--platform', 'iphone'))

    def test_mobile_rejects_mac_targets(self):
        self.assertIn('match --platform', self.rejected('--platform', 'duo', '--only-testing',
                                                       'ArcadiaUITests/Example/testWanted'))

    def test_mac_rejects_mobile_targets(self):
        self.assertIn('match --platform', self.rejected('--only-testing',
                                                       'ArcadiaMobileUITests/Example/testWanted'))

    def test_mobile_rejects_integration(self):
        self.assertIn('explicit fixture', self.rejected('--platform', 'iphone', '--integration',
                                                       '--only-testing', 'ArcadiaMobileUITests/Example/testWanted'))

    def test_mobile_target_is_a_valid_filter(self):
        runner.validate_test('ArcadiaMobileUITests/Example/testWanted')
