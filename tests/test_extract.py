"""Integration checks against a real Lean process, not a mocked extractor."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("proof_tree", ROOT / "proof_tree.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class ExtractionTests(unittest.TestCase):
    def request(self, source, declaration, **options):
        return {"source": source, "declaration": declaration, **options}

    def test_expansion_specialization_and_limits(self):
        source = (ROOT / "examples/Induction.lean").read_text()
        general = tool.extract(self.request(source, "Induction.iterate", mode="compact"))
        instance = tool.extract(self.request(source, "Induction.iterate", mode="compact",
                                            specialize=[["n", 20]], normalize=True))
        self.assertTrue(instance["kernelChecked"])
        self.assertEqual(instance["axioms"], [])
        self.assertEqual(instance["specialized"], ["n"])
        self.assertGreater(len(instance["nodes"]), len(general["nodes"]))
        self.assertFalse(any(n["rule"] == "recursor" for n in instance["nodes"]))
        self.assertTrue(any(n["rule"] == "recursor" for n in general["nodes"]))
        limited = tool.extract(self.request(source, "Induction.iterate", specialize=[["n", 80]],
                                           normalize=True, maxNodes=100))
        self.assertTrue(limited["truncated"])
        self.assertLessEqual(len(limited["nodes"]), 100)
        self.assertTrue(any(n["rule"] == "cutoff" for n in limited["nodes"]))

    def test_lemma_expansion_with_universes(self):
        source = (ROOT / "examples/Diagonal.lean").read_text()
        folded = tool.extract(self.request(source, "Diagonal.cantor"))
        expanded = tool.extract(self.request(source, "Diagonal.cantor", expand=["Diagonal.selfContradiction"]))
        self.assertEqual(expanded["displayStatement"], folded["displayStatement"])
        self.assertIn("Diagonal.selfContradiction", expanded["expansions"])
        self.assertNotIn("Diagonal.selfContradiction", expanded["references"])
        self.assertGreater(len(expanded["nodes"]), len(folded["nodes"]))
        self.assertTrue(expanded["kernelChecked"])

    def test_dependent_telescope_and_zero(self):
        source = "theorem dependent (n : Nat) (x : Fin (n+1)) : x.val = x.val := rfl\n"
        result = tool.extract(self.request(source, "dependent", specialize=[["n", 0]], normalize=True))
        self.assertEqual(result["specialized"], ["n"])
        self.assertNotIn("(n : Nat)", result["displayStatement"])
        self.assertEqual(result["axioms"], [])

    def test_expansion_depth_does_not_consume_original_arguments(self):
        source = """theorem leftId (P : Prop) (p : P) : P := p
theorem rightId (P : Prop) (p : P) : P := p
theorem joined (P : Prop) (p : P) : P := leftId P (rightId P p)
"""
        result = tool.extract(self.request(source, "joined", expandDepth=1))
        self.assertIn("leftId", result["expansions"])
        self.assertIn("rightId", result["expansions"])

    def test_incomplete_and_invalid_are_distinct(self):
        admitted = tool.extract(self.request("theorem admitted : False := by sorry\n", "admitted"))
        self.assertIn("sorryAx", admitted["axioms"])
        with self.assertRaises(tool.ProofError):
            tool.extract(self.request("theorem invalid : False := by exact True.intro\n", "invalid"))

    def test_unknown_binder_rejected(self):
        with self.assertRaisesRegex(tool.ProofError, "not found"):
            tool.extract(self.request("theorem t (n : Nat) : n = n := rfl\n", "t",
                                      specialize=[["not_a_binder", 2]]))

    def test_input_constraints(self):
        with self.assertRaises(tool.ProofError):
            tool.clean_request({"declaration": "t\n#eval 1"})
        with self.assertRaises(tool.ProofError):
            tool.clean_request({"declaration": "t", "modules": ["Mathlib\n#eval 1"]})
        with self.assertRaises(tool.ProofError):
            tool.clean_request({"declaration": "t", "maxNodes": -1})


if __name__ == "__main__":
    unittest.main(verbosity=2)
