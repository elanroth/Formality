"""Public API errors must be deliberate and descriptive."""
import unittest
import api

class ValidationTests(unittest.TestCase):
    def test_source_is_text(self):
        with self.assertRaisesRegex(api.ProofError, 'source must be a string'):
            api.clean_request({'declaration':'t', 'source': None})

    def test_declaration_is_text(self):
        with self.assertRaisesRegex(api.ProofError, 'declaration must be a string'):
            api.clean_request({'declaration': 42})

    def test_project_is_text(self):
        with self.assertRaisesRegex(api.ProofError, 'project must be a string'):
            api.clean_request({'declaration':'t', 'project': []})

    def test_nontext_option_name_is_rejected(self):
        with self.assertRaisesRegex(api.ProofError, 'Invalid Lean option'):
            api.clean_request({'declaration':'t', 'leanOptions': {1: True}})

    def test_bool_is_not_natural_specialization(self):
        with self.assertRaises(api.ProofError):
            api.clean_request({'declaration':'t', 'specialize': [['n', True]]})

    def test_duplicate_specialization_is_rejected(self):
        with self.assertRaisesRegex(api.ProofError, 'unique'):
            api.clean_request({'declaration':'t', 'specialize': [['n', 1], ['n', 2]]})

    def test_options_string_cannot_inject_newline(self):
        with self.assertRaisesRegex(api.ProofError, 'string option'):
            api.clean_request({'declaration':'t', 'leanOptions': {'trace.foo': 'hello\nworld'}})

    def test_conflicting_api_call_styles_are_rejected(self):
        with self.assertRaisesRegex(api.ProofError, 'not both'):
            api.extract({'declaration':'t'}, declaration='other')
