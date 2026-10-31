"""Exercise real capture fallback control flow with controlled OS tools."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import iteration


class CaptureFallback(unittest.TestCase):
    def test_timeout_fallback_does_not_accept_a_stale_window(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'screenshot.png'

            def external(args, **kwargs):
                if args[0] == 'xcrun':
                    raise subprocess.TimeoutExpired(args, 15)
                if args[0] == '/usr/sbin/screencapture':
                    Path(args[-1]).write_bytes(b'stale window')
                    return subprocess.CompletedProcess(args, 0)
                return subprocess.CompletedProcess(args, 3, json.dumps({'matched': False}))

            with patch('iteration.command', return_value='[42]'), patch('iteration.subprocess.run', side_effect=external), \
                    patch('iteration.time.monotonic', side_effect=[0, 0, 40]), patch('iteration.time.sleep'):
                with self.assertRaisesRegex(RuntimeError, 'stale/black images rejected'):
                    iteration.capture(Path('/helper'), lambda: [123], output, 'CURRENT', 'owned-device')
            self.assertFalse(output.exists())

    def test_simulator_timeout_still_tries_current_window(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'screenshot.png'
            calls = []

            def external(args, **kwargs):
                calls.append(args)
                if args[0] == 'xcrun':
                    raise subprocess.TimeoutExpired(args, 15)
                if args[0] == '/usr/sbin/screencapture':
                    Path(args[-1]).write_bytes(b'current window')
                    return subprocess.CompletedProcess(args, 0)
                return subprocess.CompletedProcess(args, 0, json.dumps({'matched': True}))

            with patch('iteration.command', return_value='[42]'), patch('iteration.subprocess.run', side_effect=external):
                method = iteration.capture(Path('/helper'), lambda: [123], output, 'CURRENT', 'owned-device')
            self.assertEqual(method, 'simulator-window')
            self.assertEqual(output.read_bytes(), b'current window')
            self.assertTrue(any(c[0] == '/usr/sbin/screencapture' for c in calls))

    def test_direct_simulator_capture_never_opens_or_reselects_device_hub(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'screenshot.png'
            viewer = Mock(side_effect=AssertionError('Direct iPhone capture must not disturb Duo viewer'))
            def external(args, **kwargs):
                if args[0] == 'xcrun':
                    Path(args[-1]).write_bytes(b'current simulator frame')
                    return subprocess.CompletedProcess(args, 0)
                return subprocess.CompletedProcess(args, 0, json.dumps({'matched': True}))
            with patch('iteration.subprocess.run', side_effect=external):
                self.assertEqual(iteration.capture(Path('/helper'), lambda: [], output, 'CURRENT', 'phone', viewer), 'simulator-display')
            viewer.assert_not_called()

    def test_viewer_starts_only_after_direct_capture_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'screenshot.png'
            events=[]
            def viewer():
                events.append('viewer')
                return lambda: [123]
            def external(args, **kwargs):
                if args[0] == 'xcrun':
                    events.append('direct')
                    return subprocess.CompletedProcess(args, 1)
                if args[0] == '/usr/sbin/screencapture':
                    Path(args[-1]).write_bytes(b'current Duo window')
                    return subprocess.CompletedProcess(args, 0)
                return subprocess.CompletedProcess(args, 0, json.dumps({'matched': True}))
            with patch('iteration.command',return_value='[42]'), patch('iteration.subprocess.run',side_effect=external):
                self.assertEqual(iteration.capture(Path('/helper'),lambda: [],output,'CURRENT','duo',viewer),'simulator-window')
            self.assertEqual(events,['direct','viewer'])

    def test_device_switch_stops_only_the_inactive_task_simulator(self):
        calls = []
        runtime = {'identifier': 'runtime', 'version': '27.1', 'isAvailable': True,
                   'supportedDeviceTypes': [{'identifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'}]}
        devices = [{'udid': name, 'state': 'Booted'} for name in ['duo', 'phone', 'unrelated']]

        def external(*args, **kwargs):
            calls.append(args)
            if args[2:4] == ('list', 'runtimes'):
                return json.dumps({'runtimes': [runtime]})
            if args[2:4] == ('list', 'devices'):
                return json.dumps({'devices': {'runtime': devices}})
            return ''

        with patch('iteration.command', side_effect=external):
            self.assertEqual(iteration.prepare_device('duo', {'duo:runtime': 'duo', 'iphone:other': 'phone'}), 'duo')
        self.assertIn(('xcrun', 'simctl', 'shutdown', 'phone'), calls)
        self.assertNotIn(('xcrun', 'simctl', 'shutdown', 'unrelated'), calls)
        self.assertNotIn(('xcrun', 'simctl', 'shutdown', 'duo'), calls)


if __name__ == '__main__':
    unittest.main()
