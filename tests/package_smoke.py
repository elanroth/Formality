"""Run with an installed wheel from a directory outside the source checkout."""
import json
from pathlib import Path
import sys

from formality import extract, __version__

result = extract(source="theorem identity (P : Prop) (p : P) : P := p\n",
                 declaration="identity", toolchain="leanprover/lean4:v4.35.0")
assert result["kernelChecked"]
assert result["contract"]["treeSpecification"] == "lean-expr/raw/v1"
assert result["environment"]["importedArtifacts"]
Path(sys.argv[1]).write_text(json.dumps({"version": __version__, "nodes": len(result["nodes"]),
                                     "treeSha256": result["contract"]["treeSha256"]}))
print("Installed package API passed.")
