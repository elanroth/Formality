import copy
import json
from pathlib import Path
import tempfile
import unittest

import contract
import api

ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    def test_canonical_json_excludes_paths_and_timing(self):
        tree = {k: [] for k in ["nodes", "axioms", "references", "expansions", "specialized", "parameters"]}
        tree.update(schema="proof-tree/v1", declaration="t", statement="P", displayStatement="P",
                    root=0, truncated=False, mode="raw", semantics="typed term",
                    provenance={"runId": "a"}, config={"output": "/first"})
        first = contract.digest(contract.canonical_tree(tree))
        tree["provenance"]["runId"] = "b"
        tree["config"]["output"] = "/second"
        self.assertEqual(first, contract.digest(contract.canonical_tree(tree)))
        self.assertEqual(contract.canonical_bytes({"b": 2, "a": 1}), b'{"a":1,"b":2}')

    def test_lock_mismatches_are_explained(self):
        c = {"tool": {}, "treeSpecification": "lean-expr/raw/v1", "input": {}, "options": {},
             "environmentSha256": "env", "recipeSha256": "recipe", "treeSha256": "tree"}
        tree = {"contract": c, "environment": {}, "truncated": False}
        lock = contract.make_lock(tree)
        self.assertTrue(contract.verify_lock(tree, lock)["verified"])
        for key in ["treeSha256", "environmentSha256", "options", "input", "tool"]:
            changed = copy.deepcopy(tree)
            changed["contract"][key] = "changed"
            with self.assertRaisesRegex(contract.ContractError, key):
                contract.verify_lock(changed, lock)
        with self.assertRaisesRegex(contract.ContractError, "truncated"):
            contract.make_lock({**tree, "truncated": True})

    def test_profile_rejects_typos_and_resolves_source(self):
        request, drawing = contract.load_profile(ROOT/"examples/cantor.profile.json")
        self.assertIn("theorem cantor", request["source"])
        self.assertEqual(request["toolchain"], "leanprover/lean4:v4.35.0")
        self.assertEqual(drawing["profile"], "inference-bars/v1")
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder)/"bad.json"
            p.write_text(json.dumps({"schema": contract.PROFILE_SCHEMA, "typo": True}))
            with self.assertRaisesRegex(contract.ContractError, "Unknown"):
                contract.load_profile(p)

    def test_effective_lean_options_are_typed(self):
        _, _, _, cfg = api.clean_request({"declaration": "t", "leanOptions": {"pp.universes": True}})
        self.assertTrue(cfg["leanOptions"]["pp.universes"])
        self.assertEqual(cfg["leanOptions"]["maxRecDepth"], 2048)
        with self.assertRaises(api.ProofError):
            api.clean_request({"declaration": "t", "normalize": "false"})
        with self.assertRaises(api.ProofError):
            api.clean_request({"declaration": "t", "leanOption": {}})

    def test_locked_replay_has_byte_identical_tree_and_svg(self):
        # Two actual Lean processes, independently generated driver paths/run IDs.
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            lock = folder/"proof.lock.json"
            a = api.export_profile(ROOT/"examples/cantor.profile.json", folder/"a", write_lock=lock)
            b = api.export_profile(ROOT/"examples/cantor.profile.json", folder/"b", lock=lock)
            self.assertNotEqual(a["tree"]["provenance"]["runId"], b["tree"]["provenance"]["runId"])
            self.assertEqual(a["manifest"]["treeSha256"], b["manifest"]["treeSha256"])
            for file in ["tree.canonical.json", "proof.svg"]:
                self.assertEqual((folder/"a"/file).read_bytes(), (folder/"b"/file).read_bytes())
            self.assertTrue(b["manifest"]["verification"]["verified"])
            self.assertGreater(len(a["tree"]["environment"]["importedArtifacts"]), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
