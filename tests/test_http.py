"""Real loopback HTTP requests; extraction is mocked to isolate the protocol."""
import http.client
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

import api


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = api.ThreadingHTTPServer(('127.0.0.1', 0), api.Handler)
        cls.server.token = 'test-session-secret'
        cls.server.quiet = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path='/', method='GET', body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def post(self, body='{}', **headers):
        return self.request('/api/extract', 'POST', body, {
            'Content-Type': 'application/json', 'X-ProofTree-Token': self.server.token, **headers})

    def test_html_and_security_headers(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertIn(b'Formality', body)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_config_exposes_only_local_session(self):
        status, _, body = self.request('/api/config')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['token'], self.server.token)

    def test_cross_origin_is_rejected(self):
        self.assertEqual(self.request('/api/config', headers={'Origin': 'https://evil.example'})[0], 403)

    def test_foreign_host_is_rejected(self):
        self.assertEqual(self.request('/api/config', headers={'Host': 'evil.example'})[0], 403)

    def test_static_assets_have_javascript_mime(self):
        status, headers, body = self.request('/layout.mjs')
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Type'].startswith('text/javascript'))
        self.assertIn(b'layoutProof', body)

    def test_filesystem_traversal_is_not_served(self):
        self.assertEqual(self.request('/../api.py')[0], 404)
        self.assertEqual(self.request('/api/result/../../api.py')[0], 400)

    def test_missing_result_is_404(self):
        self.assertEqual(self.request('/api/result/nonexistent-test-run')[0], 404)

    def test_extraction_requires_token(self):
        with patch.object(api, 'extract') as extract:
            self.assertEqual(self.post(**{'X-ProofTree-Token': 'wrong'})[0], 403)
            extract.assert_not_called()

    def test_malformed_json_returns_client_error(self):
        self.assertEqual(self.post('{')[0], 400)

    def test_wrong_content_type_returns_client_error(self):
        self.assertEqual(self.post(**{'Content-Type': 'text/plain'})[0], 400)

    def test_extraction_forwards_object_and_result(self):
        with patch.object(api, 'extract', return_value={'kernelChecked': True}) as extract:
            status, _, body = self.post('{"declaration":"demo"}')
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(body)['kernelChecked'])
            extract.assert_called_once_with({'declaration': 'demo'})

    def test_extraction_diagnostics_return_as_error(self):
        with patch.object(api, 'extract', side_effect=api.ProofError('invalid Lean proof')):
            status, _, body = self.post()
            self.assertEqual(status, 400)
            self.assertEqual(json.loads(body)['error'], 'invalid Lean proof')
