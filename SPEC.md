# Formality export specification, v1

This document defines what the tool draws. Package version: **0.3.0**.
Changing these semantics requires a new specification identifier. A versioned
specification supplies reproducible conventions; it does not identify all proofs
of a theorem with one canonical mathematical proof.

## Inputs and execution

`lean-proof-tree/profile/v1` takes a named declaration, either pasted Lean source
or prebuilt imported module(s), a project folder when needed, an explicit Lean
toolchain selector, Lean `-D` options, transformations, traversal limits and a
drawing profile. File/project paths in a profile are relative to that profile.
Unknown profile or extraction option names are errors, not ignored defaults.

The driver imports `Lean`, then the requested modules in their supplied order,
then the source. The exporter command is appended. Source must be a complete,
properly closed Lean file with a named declaration; modern `module`/`prelude`
files use the imported-module route. Each run uses a separate Lean process and a
`Driver.lean` file. Tactic syntax is elaborated by the selected Lean environment;
the tool does not infer deductions by parsing tactic text.

The explicit toolchain must match the project's `lean-toolchain`. For release/RC
selectors the executable's reported version must also match. The actual compiler
executable is hashed. Custom selectors are additionally identified by the reported
version and compiler hash. Uninstalled versions/dependencies are not prepared by
this tool; install/build the selected Lean project first.

Effective default command options: `maxRecDepth=2048`, `maxHeartbeats=8000000`.
`environment.leanOptions` overrides those options and supports registered Lean
boolean, natural-number and string options. Source can contain its own
`set_option`; the source bytes are part of the input identity. Default process
timeout: 180 seconds (configurable 1–1800). The transformation visit budget is
500,000. No randomness is introduced by this tool.

## Transformation order

1. Read the selected declaration's stored body, including theorem bodies that
   are opaque for ordinary computation. An axiom without a body is not a root.
2. Specialize selected outer `Nat` binders by name and value. Traverse the type's
   dependent telescope, substituting each selected value into later binder types.
   Other binders remain abstract. Unknown or non-Nat binders are errors.
3. Expand selected constants and/or theorem dependencies. Instantiate a body's
   universe parameters. Expand original application arguments at their existing
   dependency depth; enter the declaration body at depth+1; beta-apply the
   transformed arguments last. Explicit selection is not limited by the global
   theorem depth. A declaration already on the current body-expansion stack is
   left folded to break cycles. Expansion applies to all occurrences of a name.
   Lambda/Pi domains and let type annotations are not separately expanded.
4. If requested, use Lean's `Meta.reduce` with transparency `.all`,
   `explicitOnly=false`, `skipTypes=true`, `skipProofs=false`. This computes
   concrete recursors and unfolds transparent definitions. It does not automatically
   open every opaque lemma or unroll a symbolic induction indefinitely.
5. Submit the transformed closed expression, with remaining universe parameters,
   as a fresh theorem declaration to the kernel. Collect its transitive axioms.
6. Traverse that expression under the selected tree specification.

No result is returned if Lean reports errors anywhere in the driver. Kernel
acceptance is relative to the reported axioms; `sorryAx` is explicitly reported.
The exporter and renderer have not themselves been formally verified.

## `lean-expr/raw/v1`

This is a **typed expression-skeleton tree**, not a full kernel typing/conversion
derivation and not a lossless serialization from which the proof can be rebuilt.
Implicit type and data arguments present in applications are retained.

Nodes are allocated before their children, from ID 0, in the following order.
Metadata wrappers are consumed rather than drawn.

| Lean expression form | Rule category | Children, in order |
| --- | --- | --- |
| `lam` | `intro` | Binder domain, opened body |
| `forallE` | `type` | Binder domain, opened body |
| `app` | `app` | Function, argument (curried applications remain nested) |
| `letE` | `let` | Value, opened body |
| `proj` | `projection` | Structure argument |
| Bound variable, opened into local context | `hypothesis` | None |
| Theorem constant | `lemma` | None |
| Axiom constant | `axiom` | None |
| Primitive recursor constant | `recursor` | None |
| Constructor constant | `constructor` | None |
| Other constant | `reference` | None |
| Sort or literal | `type` | None |

Loose bound variables and unresolved metavariables are errors. Local binders are
opened with Lean's local-context APIs; the pretty printer supplies their visible
names. Explicit alpha-normalization is not performed. Universe levels and binder
annotations are not additional nodes. A let's type annotation is not a child.

Each node stores its ID, category, pretty-printed term, inferred type preview,
detail (binder/declaration/projection name where applicable), expandable-body
status and ordered child IDs. The display printer forces `pp.maxDepth=10` and
`pp.maxSteps=1500`, with a 2200-character preview limit; other printer options are
those of the selected Lean environment. Preview elision does not truncate the
expression traversal. These preview strings are included in the canonical tree.

## `lean-expr/compact/v1`

Uses the same traversal except:

- A lambda whose domain is not a proposition is omitted; its opened body is
  visited at the same visible depth.
- Application spines are grouped. If the head is a constructor or primitive
  recursor, that category labels the application node and the head is omitted as
  a separate child. Otherwise, the head is the first child.
- Only arguments for which Lean's `Meta.isProof` returns true are added as
  argument children, in original argument order.

Compact mode is a presentation abstraction. Its branches are not asserted to
list every premise of a primitive inference rule.

## Sharing and limits

Subexpression sharing is expanded into repeated occurrences. Default limits:
20,000 nodes and visible depth 300. At the node limit, one shared `cutoff`
placeholder is referenced for all further omitted occurrences. At the depth
limit, an explicit cutoff is added for that subtree. Thus partial exports can
contain shared placeholder IDs. The renderer repeats their visible occurrences.
`truncated=true` is recorded in the tree, manifest and figure. A partial tree
cannot be frozen into a successful reproducibility lock.

## Environment evidence and lock scope

Lean reports the direct **and transitive** imported module names and the `.olean`
paths resolved by its search path. Python hashes each actual `.olean` and existing
`.olean.private`, `.olean.server`, `.ir` and `.ilean` sidecar. A frozen environment
records these hashes, the compiler executable hash/reported version, the project's
toolchain/Lake configuration and manifest hashes, and library revision declarations
from `lake-manifest.json`. Path dependencies are covered by their actual imported
artifacts, not merely by a directory name.

Absolute resolution paths are retained as run evidence but excluded from the
environment fingerprint. Root project configuration bytes are included: changing
a path inside a Lake configuration is an environment change even when the new
path happens to contain equivalent files. A Git revision alone is not treated as
proof that the compiled artifact bytes match that revision.

This is **not a hermetic execution environment**. Arbitrary Lean metaprograms may
read files, call external programs, use clocks/randomness or load native code.
Imported artifact hashes do not capture the complete OS, native-library closure,
network or every external input. A locked replay re-executes Lean, fingerprints
the observed environment/output, and rejects a mismatch; it cannot force arbitrary
IO-dependent source to be deterministic. A lock is platform/build-specific when
compiler/artifact bytes differ. The same canonical tree hash can still be compared
independently across such environments.

## Fingerprints and files

Canonical JSON v1 is UTF-8, sorted object keys, compact separators, no ASCII
escaping and no non-finite numbers. Tree arrays retain their defined order.

- **`treeSha256`** hashes the canonical tree: schema, declaration, original/display
  statements, parameters, root, nodes, axioms, references, expansion history,
  specialization names, truncation, mode and semantics. It excludes run IDs,
  timestamps, durations, absolute paths and diagnostic logs.
- **`environmentSha256`** hashes the environment evidence described above.
- **`recipeSha256`** hashes the input source hash, selected declaration/imports,
  specification, effective options, environment identity and implementation
  identity. The latter hashes `api.py`, `contract.py`, `Exporter.lean`,
  `layout.mjs` and `render.mjs`, together with the recorded package version.
- A lock additionally pins its drawing options. A change in colors, line weight
  or dimensions is a drawing change, not a change to the extracted tree hash.

`export` writes `tree.json` (complete evidence), `tree.canonical.json` (stable
tree bytes plus one newline), `manifest.json`, the pasted `source.lean`, resolved
`drawing.json` and optionally `proof.svg`. Run drivers/logs remain in the run store.
`--write-lock` creates a lock only after success. `--lock` compares implementation,
specification, source, effective options, environment, tree hash and drawing. It
refuses the requested output bundle on a mismatch and never silently updates a lock.

For fixed recorded inputs and a matching environment, the reference implementation
has a reproducibility test requiring byte-identical canonical JSON and SVG in two
independent runs. This is an implementation test, not a formal determinism theorem.

## `inference-bars/v1`

The reference geometry is `web/layout.mjs`. Children retain source order. Leaf
weight is 1; other weights sum child leaf weights. Height is 0 at leaves and one
plus maximum child height elsewhere. Each child receives horizontal space in
proportion to leaf weight. Rows are indexed by height, so the root is below every
child. Each row contracts toward the center by `1 - taper * (height/rootHeight)`;
default taper is 0.88. Bars have no internal formulas or connectors.

Default width is `min(20000, max(1600, leaves*8))`; default height is
`min(16000, max(650, width*0.68, rootHeight*15))`. Explicit dimensions override
those defaults. Margins, text wrapping, two-decimal SVG coordinates, legend order,
figure-scaled line weights and the default rule palette are specified by the
pinned renderer source. Drawing options can set width, height, taper, line weight
and rule palette. Unsupported names and invalid values fail validation.

SVG metadata for contracted exports includes the stable contract and drawing
options, rather than random run paths. SVG bytes can therefore be compared.
SVG text uses system font families; actual glyph appearance and PNG bytes may
vary with fonts, rasterizer/browser version, platform and pixel dimensions. The
current contract does not claim pixel-identical PNGs across machines.
