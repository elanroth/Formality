"""Twenty-four distinct kernel-checked examples, in one fresh Lean process.

The batch also checks that repeated exports in the same environment work. Each
test checks a separate proof/transform scenario and structural invariants.
"""
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid

import api

ROOT = Path(__file__).resolve().parents[1]
SOURCE = r'''
namespace Corpus
universe u
theorem termId (P : Prop) (p : P) : P := p
theorem tacticId (P : Prop) (p : P) : P := by exact p
theorem compose (P Q R : Prop) (f : P → Q) (g : Q → R) (p : P) : R := g (f p)
theorem pair (P Q : Prop) (p : P) (q : Q) : P ∧ Q := ⟨p,q⟩
theorem swap (P Q : Prop) (h : P ∧ Q) : Q ∧ P := ⟨h.right,h.left⟩
theorem orLeft (P Q : Prop) (p : P) : P ∨ Q := Or.inl p
theorem orRight (P Q : Prop) (q : Q) : P ∨ Q := Or.inr q
theorem orCases (P Q R : Prop) (h : P ∨ Q) (f : P → R) (g : Q → R) : R := Or.elim h f g
theorem existsIntro : ∃ n : Nat, n = 0 := ⟨0,rfl⟩
theorem existsElim (P : Nat → Prop) (h : ∃ n, P n) : ∃ n, P n := by obtain ⟨n,hn⟩ := h; exact ⟨n,hn⟩
theorem negIntro (P Q : Prop) (f : P → Q) (g : P → ¬Q) : ¬P := fun p => g p (f p)
theorem explosion (P : Prop) (h : False) : P := False.elim h
theorem eqSymm (α : Type u) (a b : α) (h : a = b) : b = a := h.symm
theorem eqTrans (α : Type u) (a b c : α) (h : a = b) (k : b = c) : a = c := h.trans k
theorem universeProof (α : Type u) (a : α) : a = a := rfl
theorem dependent (n : Nat) (x : Fin (n+1)) : x.val = x.val := rfl
theorem letProof (P : Prop) (h : P) : P := let saved : P := h; saved
theorem inductionProof (P : Nat → Prop) (base : P 0) (step : ∀ n, P n → P (n+1)) (n : Nat) : P n := Nat.rec base (fun n ih => step n ih) n
theorem helper (P : Prop) (p : P) : P := p
theorem usingHelper (P : Prop) (p : P) : P := helper P p
axiom customPremise : False
theorem conditional : False := customPremise
theorem admitted : False := by sorry
end Corpus
'''

CASES = [
    ("term_identity", "termId", {}, {"intro", "hypothesis"}),
    ("tactic_identity", "tacticId", {}, {"intro", "hypothesis"}),
    ("implication_composition", "compose", {}, {"app"}),
    ("conjunction_introduction", "pair", {}, {"constructor"}),
    ("conjunction_swap", "swap", {}, {"app"}),
    ("disjunction_left", "orLeft", {}, {"constructor"}),
    ("disjunction_right", "orRight", {}, {"constructor"}),
    ("disjunction_elimination", "orCases", {}, {"app"}),
    ("existential_witness", "existsIntro", {}, {"constructor"}),
    ("existential_elimination", "existsElim", {}, {"app"}),
    ("negation_introduction", "negIntro", {}, {"intro", "app"}),
    ("false_elimination", "explosion", {}, {"app"}),
    ("equality_symmetry", "eqSymm", {}, {"app"}),
    ("equality_transitivity", "eqTrans", {}, {"app"}),
    ("universe_polymorphism", "universeProof", {}, {"reference"}),
    ("dependent_parameters", "dependent", {"specialize": [["n", 3]]}, {"intro"}),
    ("let_binding", "letProof", {}, {"let"}),
    ("induction_general", "inductionProof", {}, {"recursor"}),
    ("induction_zero", "inductionProof", {"specialize": [["n", 0]], "normalize": True, "mode": "compact"}, {"hypothesis"}),
    ("induction_one", "inductionProof", {"specialize": [["n", 1]], "normalize": True, "mode": "compact"}, {"app"}),
    ("induction_eight", "inductionProof", {"specialize": [["n", 8]], "normalize": True, "mode": "compact"}, {"app"}),
    ("explicit_lemma_expansion", "usingHelper", {"expand": ["Corpus.helper"]}, {"intro"}),
    ("custom_axiom_disclosure", "conditional", {}, {"axiom"}),
    ("sorry_disclosure", "admitted", {}, {"axiom"}),
]


class LeanCorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = api.RUNS / ("corpus-" + uuid.uuid4().hex[:10])
        cls.folder.mkdir(parents=True)
        driver = "import Lean\n" + SOURCE + "\n" + (ROOT/"lean/Exporter.lean").read_text()
        for label, declaration, options, _ in CASES:
            _, _, _, config = api.clean_request({"declaration": "Corpus."+declaration, **options})
            config["output"] = str(cls.folder/(label+".json"))
            driver += "\n#proof_tree " + json.dumps(json.dumps(config))
        (cls.folder/"Driver.lean").write_text(driver)
        process = subprocess.run(["lean", "+leanprover/lean4:v4.35.0", "-DmaxRecDepth=2048",
                                  "-DmaxHeartbeats=8000000", str(cls.folder/"Driver.lean")],
                                 cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True, timeout=180)
        (cls.folder/"lean.log").write_text(process.stdout+process.stderr)
        if process.returncode:
            raise AssertionError(process.stdout+process.stderr)
        cls.results = {label: json.loads((cls.folder/(label+".json")).read_text()) for label, *_ in CASES}


def case_test(label, declaration, options, rules):
    def run(self):
        result = self.results[label]
        self.assertTrue(result["kernelChecked"])
        self.assertFalse(result["truncated"])
        self.assertEqual(result["declaration"], "Corpus."+declaration)
        self.assertEqual(result["root"], 0)
        self.assertTrue(rules.issubset({n["rule"] for n in result["nodes"]}))
        for i, node in enumerate(result["nodes"]):
            self.assertEqual(i, node["id"])
            for child in node["children"]:
                self.assertGreater(child, i)
                self.assertLess(child, len(result["nodes"]))
        if label == "universe_polymorphism":
            self.assertIn("Type u", result["displayStatement"])
            self.assertIn("rfl", result["references"])
        if label == "custom_axiom_disclosure":
            self.assertEqual(result["axioms"], ["Corpus.customPremise"])
        elif label == "sorry_disclosure":
            self.assertIn("sorryAx", result["axioms"])
        else:
            self.assertEqual(result["axioms"], [])
        if label.startswith("induction_") and options.get("normalize"):
            self.assertFalse(any(n["rule"] == "recursor" for n in result["nodes"]))
            self.assertEqual(result["specialized"], ["n"])
            expected_steps = options["specialize"][0][1]
            self.assertEqual(sum(n["rule"] == "app" for n in result["nodes"]), expected_steps)
        if label == "explicit_lemma_expansion":
            self.assertIn("Corpus.helper", result["expansions"])
            self.assertNotIn("Corpus.helper", result["references"])
    return run


for _case in CASES:
    setattr(LeanCorpusTests, "test_"+_case[0], case_test(*_case))
