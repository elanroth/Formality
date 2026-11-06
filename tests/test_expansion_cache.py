"""Memoization must preserve per-occurrence history and visible binder names."""
import unittest
import api

class ExpansionCacheTests(unittest.TestCase):
    def test_closed_repetition_retains_each_expansion(self):
        source = '''theorem leaf : True := True.intro
theorem repeated : True ∧ True := ⟨leaf, leaf⟩
'''
        tree = api.extract(source=source, declaration='repeated', expand=['leaf'])
        self.assertTrue(tree['kernelChecked'])
        self.assertEqual(tree['expansions'], ['leaf', 'leaf'])
        self.assertNotIn('leaf', tree['references'])
        self.assertEqual(tree['axioms'], [])

    def test_alpha_equivalent_terms_keep_distinct_binder_names(self):
        source = '''theorem left : True → True := fun leftBinder => leftBinder
theorem right : True → True := fun rightBinder => rightBinder
theorem both : (True → True) ∧ (True → True) := ⟨left, right⟩
'''
        tree = api.extract(source=source, declaration='both', expand=['left','right'])
        self.assertTrue(tree['kernelChecked'])
        details = {n['detail'] for n in tree['nodes'] if n['rule']=='intro'}
        self.assertIn('leftBinder', details)
        self.assertIn('rightBinder', details)
        self.assertEqual(tree['expansions'], ['left', 'right'])

    def test_open_arguments_remain_in_their_own_context(self):
        source = """theorem keep (P : Prop) (p : P) : P := p
theorem separate (P Q : Prop) (p : P) (q : Q) : P ∧ Q := ⟨keep P p, keep Q q⟩
"""
        tree = api.extract(source=source, declaration='separate', expand=['keep'])
        self.assertTrue(tree['kernelChecked'])
        self.assertEqual(tree['expansions'], ['keep', 'keep'])
        self.assertEqual(tree['axioms'], [])
        variables = {n['term'] for n in tree['nodes'] if n['rule']=='hypothesis'}
        self.assertTrue({'p', 'q'}.issubset(variables))

    def test_transformation_budget_is_validated_and_recorded(self):
        _, _, _, cfg = api.clean_request({'declaration': 't', 'maxVisits': 2000000})
        self.assertEqual(cfg['maxVisits'], 2000000)
        with self.assertRaises(api.ProofError):
            api.clean_request({'declaration':'t', 'maxVisits': True})
