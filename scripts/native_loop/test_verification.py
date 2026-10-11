import unittest
import verification


def results(*items):
    return {'testNodes': [{'nodeType': 'Test Case', 'nodeIdentifierURL': 'test://com.apple.xcode/Arcadia/' + identifier, 'result': result} for identifier, result in items]}


class VerificationTests(unittest.TestCase):
    def test_requested_method_cannot_be_replaced_by_other_passing_tests(self):
        with self.assertRaisesRegex(ValueError, 'Missing'):
            verification.verify(results(('ArcadiaUITests/Example/testOther', 'Passed')), ['ArcadiaUITests/Example/testWanted'])

    def test_skipped_requested_test_is_not_behavior_verification(self):
        with self.assertRaisesRegex(ValueError, 'Skipped'):
            verification.verify(results(('ArcadiaUITests/Example/testWanted', 'Skipped')), ['ArcadiaUITests/Example/testWanted'])

    def test_class_selection_records_actual_methods_and_rejects_extra_classes(self):
        actual = results(('ArcadiaTests/Example/testOne', 'Passed'), ('ArcadiaTests/Example/testTwo', 'Passed'))
        evidence = verification.verify(actual, ['ArcadiaTests/Example'])
        self.assertEqual(evidence['executed_tests'], ['ArcadiaTests/Example/testOne', 'ArcadiaTests/Example/testTwo'])
        with self.assertRaisesRegex(ValueError, 'Unexpected'):
            verification.verify(actual, ['ArcadiaTests/Example/testOne'])

    def test_empty_results_fail(self):
        with self.assertRaises(ValueError):
            verification.verify(results(), ['ArcadiaTests/Example'])


class GuestArgumentsTests(unittest.TestCase):
    def test_empty_selection_fails_before_any_guest_work(self):
        import subprocess
        from pathlib import Path
        completed = subprocess.run(['/bin/bash', str(Path(__file__).with_name('guest.sh')), 'test', 'task', 'run', 'only-testing'], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 2)
        self.assertIn('requires at least one identifier', completed.stdout)
        self.assertNotIn('unbound variable', completed.stderr)

    def test_missing_selection_marker_cannot_silently_run_default_suite(self):
        import subprocess
        from pathlib import Path
        completed = subprocess.run(['/bin/bash', str(Path(__file__).with_name('guest.sh')), 'test', 'task', 'run', 'ArcadiaUITests/Example/testWanted'], capture_output=True, text=True)
        self.assertEqual(completed.returncode, 2)
        self.assertIn('prefix selected identifiers', completed.stdout)


if __name__ == '__main__':
    unittest.main()
