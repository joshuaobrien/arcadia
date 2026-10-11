import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class DiagnosticsPolicyTests(unittest.TestCase):
    def invoke(self, policy, help_text):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / 'xcodebuild'
            executable.write_text('#!/bin/sh\nprintf "%s\\n" "$XCODE_HELP"\n')
            executable.chmod(0o755)
            return subprocess.run(['/bin/bash', str(Path(__file__).with_name('diagnostics.sh')), policy], env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'], 'XCODE_HELP': help_text}, capture_output=True, text=True)

    def test_targeted_supported_sdk_skips_expensive_system_diagnostics(self):
        result = self.invoke('targeted', '-collect-test-diagnostics <mode>')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.splitlines(), ['-collect-test-diagnostics', 'never'])

    def test_old_sdk_keeps_default_diagnostics(self):
        result = self.invoke('targeted', 'older help')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_full_keeps_xcode_default_even_when_supported(self):
        result = self.invoke('full', '-collect-test-diagnostics <mode>')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_unknown_policy_rejected(self):
        self.assertNotEqual(self.invoke('typo', '').returncode, 0)

    def test_empty_optional_arguments_work_on_guest_bash(self):
        result = subprocess.run(['/bin/bash', '-c', 'set -u; arguments=(); printf "%s" start ${arguments[@]+"${arguments[@]}"} end'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'startend')
