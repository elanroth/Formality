"""Versioned inputs, content fingerprints and replay verification."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import subprocess

VERSION = "0.3.0"
PROFILE_SCHEMA = "lean-proof-tree/profile/v1"
LOCK_SCHEMA = "lean-proof-tree/lock/v1"
SPEC = {"raw": "lean-expr/raw/v1", "compact": "lean-expr/compact/v1"}
ROOT = Path(__file__).resolve().parent


class ContractError(ValueError):
    pass


def canonical_bytes(value):
    """v1 canonical JSON: sorted keys, UTF-8, no whitespace, finite JSON values."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def file_digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else _stream_hash(stream)


def _stream_hash(stream):
    h = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        h.update(chunk)
    return h.hexdigest()


def implementation():
    files = ["api.py", "contract.py", "lean/Exporter.lean", "web/layout.mjs", "render.mjs"]
    hashes = {name: file_digest(ROOT / name) for name in files}
    return {"version": VERSION, "files": hashes, "sha256": digest(hashes)}


def capture_environment(project, version, command_prefix, env, imports):
    def query(flag):
        p = subprocess.run(command_prefix + [flag], cwd=project, env=env, text=True,
                           capture_output=True, timeout=30)
        if p.returncode:
            raise ContractError(p.stderr or p.stdout or f"Cannot query Lean {flag}")
        return p.stdout.strip()

    actual = query("--version")
    tag = version.rsplit(":", 1)[-1]
    if re.fullmatch(r"v\d+\.\d+\.\d+(?:-rc\d+)?", tag):
        match = re.search(r"Lean \(version ([^, ]+)", actual)
        if not match or match.group(1) != tag[1:]:
            raise ContractError(f"Requested {version}, but the executable reports: {actual}")
    prefix = Path(query("--print-prefix"))
    compiler = prefix / "bin" / ("lean.exe" if (prefix / "bin/lean.exe").exists() else "lean")
    artifacts, paths = [], []
    for item in sorted(imports, key=lambda x: x["module"]):
        base = Path(item["path"])
        base = (base if base.is_absolute() else project/base).resolve()
        # Newer Lean versions split module data over private/server sidecars.
        candidates = [("olean", base), ("olean.private", Path(str(base)+".private")),
                      ("olean.server", Path(str(base)+".server")),
                      ("ir", base.with_suffix(".ir")), ("ilean", base.with_suffix(".ilean"))]
        hashes = {kind: file_digest(path) for kind, path in candidates if path.is_file()}
        if "olean" not in hashes:
            raise ContractError(f"Imported module artifact disappeared: {item['module']}")
        artifacts.append({"module": item["module"], "files": hashes})
        paths.append({"module": item["module"], "path": str(base)})
    configs = {name: file_digest(project/name) for name in
               ["lean-toolchain", "lake-manifest.json", "lakefile.lean", "lakefile.toml"]
               if (project/name).is_file()}
    manifest = project/"lake-manifest.json"
    libraries = []
    if manifest.exists():
        for package in json.loads(manifest.read_text()).get("packages", []):
            libraries.append({k: package[k] for k in ["name", "type", "rev", "url", "dir", "subDir"] if k in package})
    # Absolute resolution paths are evidence, not part of the portable identity.
    identity = {"toolchain": version, "reportedVersion": actual,
                "compilerSha256": file_digest(compiler), "projectConfig": configs,
                "libraries": libraries, "importedArtifacts": artifacts}
    return {**identity, "sha256": digest(identity), "resolvedPaths": paths,
            "compilerPath": str(compiler.resolve())}


def canonical_tree(tree):
    keys = ["schema", "declaration", "statement", "displayStatement", "parameters", "root",
            "nodes", "axioms", "references", "expansions", "specialized", "truncated", "mode", "semantics"]
    # This representation includes pretty-printed labels. Their printer options
    # and implementation are part of the versioned specification.
    return {key: tree[key] for key in keys}


def attach_contract(tree, request, environment):
    options = {key: request[key] for key in ["mode", "expand", "expandDepth", "maxNodes", "maxDepth",
                                           "normalize", "specialize"]}
    options["leanOptions"] = request["leanOptions"]
    options["timeoutSeconds"] = request["timeoutSeconds"]
    impl = implementation()
    inputs = {"sourceSha256": tree["provenance"]["sourceSha256"],
              "declaration": request["declaration"], "modules": request["modules"]}
    contract = {"schema": "lean-proof-tree/contract/v1", "tool": impl,
                "treeSpecification": SPEC[request["mode"]],
                "input": inputs, "options": options,
                "environmentSha256": environment["sha256"],
                "treeSha256": digest(canonical_tree(tree))}
    contract["recipeSha256"] = digest({k: v for k, v in contract.items() if k != "treeSha256"})
    tree["contract"], tree["environment"] = contract, environment
    return tree


def make_lock(tree, drawing=None):
    if tree["truncated"]:
        raise ContractError("Cannot lock a truncated tree. Increase the node/depth limits first.")
    drawing = drawing or {"profile": "inference-bars/v1"}
    return {"schema": LOCK_SCHEMA, "contract": tree["contract"],
            "environment": {k: v for k, v in tree["environment"].items()
                            if k not in ("resolvedPaths", "compilerPath")},
            "drawing": drawing, "drawingSha256": digest(drawing)}


def verify_lock(tree, lock, drawing=None):
    if lock.get("schema") != LOCK_SCHEMA:
        raise ContractError("Unsupported proof-tree lock schema.")
    expected = lock.get("contract", {})
    current = tree["contract"]
    mismatches = []
    for key in ["tool", "treeSpecification", "input", "options", "environmentSha256", "recipeSha256", "treeSha256"]:
        if expected.get(key) != current.get(key):
            mismatches.append(key)
    if drawing is not None and lock.get("drawingSha256") != digest(drawing):
        mismatches.append("drawing")
    if tree["truncated"]:
        mismatches.append("truncated")
    if mismatches:
        raise ContractError("Locked export differs: " + ", ".join(mismatches))
    return {"verified": True, "recipeSha256": current["recipeSha256"],
            "treeSha256": current["treeSha256"]}


def _keys(value, allowed, label):
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object.")
    extra = set(value) - set(allowed)
    if extra:
        raise ContractError(f"Unknown {label} field(s): {', '.join(sorted(extra))}")


def load_profile(path):
    """Load a portable, explicit profile; resolve its paths relative to the file."""
    path = Path(path).resolve()
    profile = json.loads(path.read_text())
    _keys(profile, ["schema", "treeSpecification", "input", "environment", "transform", "limits", "drawing"], "profile")
    if profile.get("schema") != PROFILE_SCHEMA:
        raise ContractError("Unsupported profile schema.")
    spec = profile.get("treeSpecification")
    if spec not in SPEC.values():
        raise ContractError("treeSpecification must be lean-expr/raw/v1 or lean-expr/compact/v1.")
    inp, environment = profile.get("input", {}), profile.get("environment", {})
    transform, limits = profile.get("transform", {}), profile.get("limits", {})
    _keys(inp, ["source", "sourceFile", "project", "modules", "declaration"], "input")
    _keys(environment, ["toolchain", "leanOptions"], "environment")
    _keys(transform, ["expand", "expandDepth", "specialize", "normalize"], "transform")
    _keys(limits, ["maxNodes", "maxDepth", "timeoutSeconds"], "limits")
    if not environment.get("toolchain"):
        raise ContractError("A profile must pin environment.toolchain explicitly.")
    if "source" in inp and "sourceFile" in inp:
        raise ContractError("Specify source or sourceFile, not both.")
    source = inp.get("source", "")
    if "sourceFile" in inp:
        source = (path.parent/inp["sourceFile"]).read_text()
    project = inp.get("project")
    if project:
        project = str((path.parent/project).resolve())
    drawing_input = profile.get("drawing", {})
    _keys(drawing_input, ["profile", "width", "height", "taper", "stroke", "palette"], "drawing")
    drawing = {"profile": "inference-bars/v1", "taper": .88, "stroke": 1.5, **drawing_input}
    _keys(drawing, ["profile", "width", "height", "taper", "stroke", "palette"], "drawing")
    if drawing["profile"] != "inference-bars/v1":
        raise ContractError("Unsupported drawing profile.")
    for key in ("width", "height"):
        if key in drawing and (isinstance(drawing[key], bool) or not isinstance(drawing[key], (int, float))
                               or not 100 <= drawing[key] <= 100000):
            raise ContractError(f"drawing.{key} must be between 100 and 100000.")
    for key, low, high in [("stroke", 0, 20), ("taper", 0, 1)]:
        v = drawing[key]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not low <= v <= high or (key == "taper" and v == 1) or (key == "stroke" and v == 0):
            raise ContractError(f"Invalid drawing.{key}.")
    if "palette" in drawing and (not isinstance(drawing["palette"], dict) or
        not all(isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) for v in drawing["palette"].values())):
        raise ContractError("drawing.palette must map rule names to #rrggbb colors.")
    allowed_rules = {"intro", "app", "constructor", "recursor", "lemma", "reference", "hypothesis",
                     "type", "projection", "let", "axiom", "cutoff"}
    if set(drawing.get("palette", {})) - allowed_rules:
        raise ContractError("Unknown drawing palette rule name.")
    request = {"source": source, "project": project or "", "modules": inp.get("modules", []),
               "declaration": inp.get("declaration", ""), "mode": next(k for k, v in SPEC.items() if v == spec),
               "toolchain": environment["toolchain"], "leanOptions": environment.get("leanOptions", {}),
               **transform, **limits}
    return request, drawing
