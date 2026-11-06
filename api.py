#!/usr/bin/env python3
"""Local Lean proof-term extractor and viewer. No Python packages required."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
if __package__:
    from .contract import (VERSION, ContractError, attach_contract, canonical_bytes,
                           canonical_tree, capture_environment, load_profile,
                           make_lock, verify_lock)
else:
    from contract import (VERSION, ContractError, attach_contract, canonical_bytes,
                          canonical_tree, capture_environment, load_profile,
                          make_lock, verify_lock)

ROOT = Path(__file__).resolve().parent
RUNS = Path(os.environ.get("FORMALITY_RUNS", os.environ.get("LEAN_PROOF_TREE_RUNS", str(
    ROOT / "runs" if (ROOT/"pyproject.toml").exists() else Path.home()/".cache/formality/runs"))))
DEFAULT_VERSION = (ROOT / "lean-toolchain").read_text().strip()
DEFAULT_MATHLIB = os.environ.get("FORMALITY_MATHLIB_PROJECT")
MAX_SOURCE = 512_000
MAX_CONCURRENT = threading.BoundedSemaphore(2)


class ProofError(Exception):
    pass


def integer(value, name, lower, upper):
    if isinstance(value, bool) or not isinstance(value, int) or not lower <= value <= upper:
        raise ProofError(f"{name} must be an integer between {lower} and {upper}.")
    return value


def clean_request(request):
    if not isinstance(request, dict):
        raise ProofError("Expected a JSON object.")
    allowed = {"source", "project", "modules", "declaration", "mode", "expand", "expandDepth",
               "maxNodes", "maxDepth", "normalize", "specialize", "toolchain", "leanOptions", "timeoutSeconds"}
    if set(request) - allowed:
        raise ProofError("Unknown extraction option(s): " + ", ".join(sorted(set(request)-allowed)))
    for field in ("source", "declaration", "project"):
        if field in request and not isinstance(request[field], str):
            raise ProofError(f"{field} must be a string.")
    declaration = request.get("declaration", "").strip()
    if not declaration or len(declaration) > 400 or any(c.isspace() for c in declaration):
        raise ProofError("Enter the fully qualified declaration name, for example Demo.cantor.")
    project = str(request.get("project", "")).strip()
    project_path = Path(project).expanduser().resolve() if project else ROOT
    if not project_path.is_dir():
        raise ProofError(f"Project folder does not exist: {project_path}")
    source = str(request.get("source", ""))
    if len(source.encode()) > MAX_SOURCE:
        raise ProofError("Source exceeds the 512 KB limit. Import its module from a Lean project instead.")
    modules = request.get("modules", [])
    if not isinstance(modules, list) or len(modules) > 30 or not all(
        isinstance(m, str) and re.fullmatch(r"[\w'.]+", m, re.UNICODE) for m in modules
    ):
        raise ProofError("Modules must be a list of Lean module names.")
    mode = request.get("mode", "raw")
    if mode not in ("raw", "compact"):
        raise ProofError("Mode must be raw or compact.")
    expand = request.get("expand", [])
    if not isinstance(expand, list) or len(expand) > 100 or not all(isinstance(x, str) and len(x) < 400 for x in expand):
        raise ProofError("Expand must be a list of at most 100 declaration names.")
    specialization = request.get("specialize", [])
    if not isinstance(specialization, list) or len(specialization) > 20:
        raise ProofError("Specialize must be a list of [binder, natural number] pairs.")
    for item in specialization:
        if not isinstance(item, list) or len(item) != 2 or not isinstance(item[0], str):
            raise ProofError("Each specialization must be [binder name, natural number].")
        integer(item[1], "n", 0, 10000)
    if len({x[0] for x in specialization}) != len(specialization):
        raise ProofError("Specialization binder names must be unique.")
    if not isinstance(request.get("normalize", False), bool):
        raise ProofError("normalize must be a boolean.")
    options = {"maxRecDepth": 2048, "maxHeartbeats": 8000000}
    supplied = request.get("leanOptions", {})
    if not isinstance(supplied, dict):
        raise ProofError("leanOptions must be an object.")
    for name, value in supplied.items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", name) or not isinstance(value, (bool, int, str)):
            raise ProofError(f"Invalid Lean option: {name}")
        if isinstance(value, int) and not isinstance(value, bool) and value < 0:
            raise ProofError(f"Lean Nat option {name} cannot be negative.")
        if isinstance(value, str) and (len(value)>4096 or '\n' in value or '\r' in value):
            raise ProofError(f"Invalid Lean string option: {name}")
        options[name] = value
    toolchain = request.get("toolchain")
    if toolchain is not None and (not isinstance(toolchain, str) or not re.fullmatch(r"[\w./:+-]+", toolchain)):
        raise ProofError("Invalid toolchain selector.")
    config = {
        "declaration": declaration,
        "mode": mode,
        "expand": expand,
        "expandDepth": integer(request.get("expandDepth", 0), "Expansion depth", 0, 8),
        "maxNodes": integer(request.get("maxNodes", 20000), "Node budget", 100, 100000),
        "maxDepth": integer(request.get("maxDepth", 300), "Depth budget", 10, 500),
        "normalize": request.get("normalize", False),
        "specialize": specialization,
    }
    config["leanOptions"] = options
    config["timeoutSeconds"] = integer(request.get("timeoutSeconds", 180), "Timeout", 1, 1800)
    config["toolchain"] = toolchain
    return project_path, source, modules, config


def extract(request=None, *, source=None, declaration=None, **options):
    """Extract a kernel-checked tree with a versioned content contract.

    Use extract(source="theorem ...", declaration="Name", toolchain="...")
    or pass the equivalent request dictionary. Lean code is executed locally.
    """
    if request is not None and (source is not None or declaration is not None or options):
        raise ProofError("Pass a request object or keyword arguments, not both.")
    if request is None:
        request = {"source": source or "", "declaration": declaration or "", **options}
    project, source, modules, config = clean_request(request)
    if not shutil.which("lean"):
        raise ProofError("Lean is not on PATH. Install elan, then restart the tool from a terminal with Lean available.")
    if not MAX_CONCURRENT.acquire(blocking=False):
        raise ProofError("Two extractions are running. Wait for one to finish.")
    try:
        start = time.monotonic()
        RUNS.mkdir(parents=True, exist_ok=True)
        run_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(4)
        run_dir = RUNS / run_id
        run_dir.mkdir()
        config["output"] = str(run_dir / "tree.json")
        toolchain = (project / "lean-toolchain")
        project_version = toolchain.read_text().strip() if toolchain.exists() else None
        version = config["toolchain"] or project_version or DEFAULT_VERSION
        if project_version and config["toolchain"] and project_version != config["toolchain"]:
            raise ProofError(f"Toolchain mismatch: profile requests {config['toolchain']}, project pins {project_version}.")
        is_lake = (project / "lakefile.lean").exists() or (project / "lakefile.toml").exists()
        # Imports must precede commands. Additional requested imports go before source.
        prefix = "import Lean\n" + "".join(f"import {module}\n" for module in modules)
        driver = prefix + source + "\n\n" + (ROOT / "lean" / "Exporter.lean").read_text()
        # No user values are interpolated into executable Lean syntax outside a string.
        encoded = json.dumps(json.dumps(config, ensure_ascii=False), ensure_ascii=False)
        driver += "\n#proof_tree " + encoded + "\n"
        (run_dir / "Driver.lean").write_text(driver)
        (run_dir / "request.json").write_text(json.dumps(request, ensure_ascii=False, indent=2))
        (run_dir / "source.lean").write_text(source)
        command_prefix = ["lake", "env", "lean"] if is_lake else ["lean", "+" + version]
        def option_arg(name, value):
            value = str(value).lower() if isinstance(value, bool) else str(value)
            return f"-D{name}={value}"
        command = command_prefix + [option_arg(k,v) for k,v in sorted(config["leanOptions"].items())]
        command += [str(run_dir / "Driver.lean")]
        env = os.environ.copy()
        # Elan's explicit version also works if no project toolchain file exists.
        env["ELAN_TOOLCHAIN"] = version
        with (run_dir / "lean.log").open("w") as log:
            process = subprocess.Popen(command, cwd=project, env=env, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            try:
                code = process.wait(timeout=config["timeoutSeconds"])
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise ProofError(f"Lean exceeded {config['timeoutSeconds']} seconds. Reduce expansion or normalization. Run saved in {run_dir}")
        logs = (run_dir / "lean.log").read_text(errors="replace")
        if code != 0 or not (run_dir / "tree.json").exists():
            # JSON must never be returned for a file with subsequent Lean errors.
            raise ProofError(logs[-16000:] or "Lean produced no export. Check the declaration name and imports.")
        tree = json.loads((run_dir / "tree.json").read_text())
        identity = hashlib.sha256(driver.encode()).hexdigest()
        tree["provenance"] = {
            "leanVersion": version, "project": str(project), "modules": modules,
            "sourceSha256": hashlib.sha256(source.encode()).hexdigest(),
            "driverSha256": identity, "runId": run_id,
            "seconds": round(time.monotonic() - start, 2), "command": command,
            "sourceKind": "pasted" if source.strip() else "imported module",
        }
        tree["diagnostics"] = logs[-6000:]
        tree["request"] = {**request, "project": str(project)}
        effective = {**config, "modules": modules}
        environment = capture_environment(project, version, command_prefix, env, tree.pop("importedModules"))
        attach_contract(tree, effective, environment)
        (run_dir / "tree.json").write_text(json.dumps(tree, ensure_ascii=False))
        return tree
    except ContractError as error:
        raise ProofError(str(error)) from error
    finally:
        MAX_CONCURRENT.release()


def export_profile(profile, output, *, lock=None, write_lock=None, svg=True):
    """Execute a profile and optionally verify/write its exact environment lock.

    Returns the tree and stable fingerprints. Published output files are only
    written after any supplied lock passes verification.
    """
    try:
        request, drawing = load_profile(profile)
        tree = extract(request)
        expected = json.loads(Path(lock).read_text()) if lock else None
        verification = verify_lock(tree, expected, drawing) if expected else None
        if write_lock:
            frozen = make_lock(tree, drawing)
        output = Path(output)
        output.mkdir(parents=True, exist_ok=True)
        (output/"tree.json").write_text(json.dumps(tree, ensure_ascii=False))
        (output/"tree.canonical.json").write_bytes(canonical_bytes(canonical_tree(tree))+b"\n")
        manifest = {"schema": "lean-proof-tree/export/v1", **tree["contract"],
                    "drawing": drawing, "verification": verification,
                    "kernelChecked": tree["kernelChecked"], "axioms": tree["axioms"], "truncated": tree["truncated"]}
        (output/"manifest.json").write_bytes(canonical_bytes(manifest)+b"\n")
        (output/"source.lean").write_text(request["source"])
        (output/"drawing.json").write_bytes(canonical_bytes(drawing)+b"\n")
        if svg:
            subprocess.run(["node", str(ROOT/"render.mjs"), str(output/"tree.json"),
                            str(output/"proof.svg"), str(output/"drawing.json")], check=True)
        if write_lock:
            Path(write_lock).parent.mkdir(parents=True, exist_ok=True)
            Path(write_lock).write_bytes(canonical_bytes(frozen)+b"\n")
        return {"tree": tree, "manifest": manifest, "output": str(output.resolve())}
    except ContractError as error:
        raise ProofError(str(error)) from error


def examples():
    data = json.loads((ROOT / "examples" / "catalog.json").read_text())
    for item in data:
        if "file" in item:
            item["request"]["source"] = (ROOT / "examples" / item["file"]).read_text()
        if item.pop("mathlibProject", False):
            item["request"]["project"] = str(Path(DEFAULT_MATHLIB).expanduser().resolve()) if DEFAULT_MATHLIB else ""
            item["available"] = bool(DEFAULT_MATHLIB and Path(DEFAULT_MATHLIB).expanduser().is_dir())
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if not self.server.quiet:
            super().log_message(fmt, *args)

    def reply(self, code, body, content_type="application/json; charset=utf-8"):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        host = self.headers.get("Host", "")
        expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        origin = self.headers.get("Origin")
        return host in expected and (not origin or origin in {"http://" + h for h in expected})

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {"error": "Local origin required."})
        path = urlsplit(self.path).path
        if path == "/api/config":
            return self.reply(200, {"token": self.server.token, "toolchain": DEFAULT_VERSION})
        if path == "/api/examples":
            return self.reply(200, examples())
        if path.startswith("/api/result/"):
            run = path.removeprefix("/api/result/")
            if not re.fullmatch(r"[\w-]+", run):
                return self.reply(400, {"error": "Invalid run ID."})
            file = RUNS / run / "tree.json"
        else:
            known = {"/": "index.html", "/app.mjs": "app.mjs", "/style.css": "style.css",
                     "/layout.mjs": "layout.mjs"}
            if path not in known:
                return self.reply(404, {"error": "Not found."})
            file = ROOT / "web" / known[path]
        if not file.exists():
            return self.reply(404, {"error": "Not found."})
        types = {".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}
        self.reply(200, file.read_bytes(), types[file.suffix])

    def do_POST(self):
        if not self.allowed() or self.headers.get("X-ProofTree-Token") != self.server.token:
            return self.reply(403, {"error": "Local session token required."})
        if urlsplit(self.path).path != "/api/extract":
            return self.reply(404, {"error": "Not found."})
        try:
            if self.headers.get_content_type() != "application/json":
                raise ProofError("Expected application/json.")
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > 2_000_000:
                raise ProofError("Request body must be between 1 byte and 2 MB.")
            request = json.loads(self.rfile.read(length))
            self.reply(200, extract(request))
        except (ProofError, ValueError) as error:
            self.reply(400, {"error": str(error)})
        except Exception as error:
            self.reply(500, {"error": f"{type(error).__name__}: {error}"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="action", required=True)
    serve = subs.add_parser("serve", help="Start the local graphical interface")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--quiet", action="store_true")
    export = subs.add_parser("export", help="Run a versioned profile with an optional reproducibility lock")
    export.add_argument("profile", type=Path)
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--lock", type=Path, help="Refuse results that differ from this lock")
    export.add_argument("--write-lock", type=Path, help="Record a new explicit lock after a successful export")
    export.add_argument("--no-svg", action="store_true")
    render = subs.add_parser("render", help="Extract a declaration to JSON, optionally SVG")
    render.add_argument("--source", type=Path)
    render.add_argument("--project", default="")
    render.add_argument("--module", action="append", default=[])
    render.add_argument("--declaration", required=True)
    render.add_argument("--mode", choices=["raw", "compact"], default="raw")
    render.add_argument("--expand", action="append", default=[])
    render.add_argument("--expand-depth", type=int, default=0)
    render.add_argument("--nat", action="append", default=[], metavar="BINDER=N")
    render.add_argument("--normalize", action="store_true")
    render.add_argument("--max-nodes", type=int, default=20000)
    render.add_argument("--max-depth", type=int, default=300)
    render.add_argument("--toolchain")
    render.add_argument("--lean-option", action="append", default=[], metavar="NAME=JSON_VALUE")
    render.add_argument("--timeout", type=int, default=180)
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--svg", type=Path)
    args = parser.parse_args()
    if args.action == "export":
        try:
            result = export_profile(args.profile, args.output, lock=args.lock,
                                    write_lock=args.write_lock, svg=not args.no_svg)
            print(json.dumps({"output": result["output"], "treeSha256": result["manifest"]["treeSha256"],
                              "lockedReplay": bool(args.lock)}))
        except (ProofError, ValueError, OSError) as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)
        return
    if args.action == "serve":
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
        server.token, server.quiet = secrets.token_urlsafe(32), args.quiet
        print(f"Formality: http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return
    specialization = []
    lean_options = {}
    for item in args.lean_option:
        try:
            name, value = item.split("=", 1)
            lean_options[name] = json.loads(value)
        except ValueError:
            parser.error('--lean-option must be NAME=JSON_VALUE, such as pp.universes=true')
    for item in args.nat:
        try:
            binder, numeral = item.rsplit("=", 1)
            specialization.append([binder, int(numeral)])
        except ValueError:
            parser.error("--nat must be BINDER=N, such as --nat n=20")
    request = {
        "source": args.source.read_text() if args.source else "", "project": args.project,
        "modules": args.module, "declaration": args.declaration, "mode": args.mode,
        "expand": args.expand, "expandDepth": args.expand_depth, "specialize": specialization,
        "normalize": args.normalize, "maxNodes": args.max_nodes, "maxDepth": args.max_depth,
        "toolchain": args.toolchain, "leanOptions": lean_options, "timeoutSeconds": args.timeout,
    }
    try:
        tree = extract(request)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(tree, ensure_ascii=False))
        if args.svg:
            subprocess.run(["node", str(ROOT / "render.mjs"), str(args.output), str(args.svg)], check=True)
        print(f"{len(tree['nodes'])} nodes; kernel checked; axioms: {tree['axioms']}; truncated: {tree['truncated']}")
        print(args.output.resolve())
    except ProofError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
