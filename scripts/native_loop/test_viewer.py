import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import viewer


class ViewerTests(unittest.TestCase):
    def test_credentials_never_go_to_an_unowned_endpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'viewer.json'
            path.write_text(json.dumps({'owner': 'other', 'task': 'task', 'port': 5900}))
            with patch('viewer.os.execve') as execute, self.assertRaises(ValueError):
                viewer.launch(path, '/tmp/viewer')
            execute.assert_not_called()

    def test_validated_connection_has_no_login_or_reconnect_prompt(self):
        with patch('viewer.connection', return_value={'port': 15000}), patch('viewer.os.execve') as execute:
            viewer.launch('/tmp/config', '/tmp/viewer')
        binary, arguments, environment = execute.call_args.args
        self.assertEqual(arguments[-1], '127.0.0.1::15000')
        self.assertIn('-ReconnectOnError=0', arguments)
        self.assertIn('-AlertOnFatalError=0', arguments)
        self.assertEqual(environment['VNC_USERNAME'], 'admin')
        self.assertEqual(environment['VNC_PASSWORD'], 'admin')
