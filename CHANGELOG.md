# Changelog

## 0.4.0 — 2026-11-06

- Memoize lemma expansion by structural expression, dependency depth, and active
  expansion stack, while preserving binder names and per-occurrence expansion history.
- Expose the transformation work budget through `maxVisits`, profile limits, and
  `--max-visits`, retaining the default of 500,000 uncached visits.
- Render Foundation's actual first incompleteness theorem at expansion depths 0–3
  (depth 3 explicitly reaches the display cap);
  include a pinned reproduction profile, image, and provenance documentation.
- Add regression coverage for repeated closed proofs, distinct binder names,
  open local contexts, and budget validation.

## 0.3.0 — 2026-11-06

First public release as **Formality**, under the MIT license.

- Lean expression extraction with fresh kernel submission and axiom disclosure.
- Raw and compact views, selected/depth-based lemma expansion, natural-number
  specialization, concrete recursor normalization, explicit traversal budgets.
- Local browser viewer with configurable colored inference bars and PNG/SVG/JSON export.
- Installable `formality-lean` package, `formality` API/CLI, versioned profiles,
  environment/artifact fingerprints, and strict reproducibility locks.
- Callable Lean `exportDeclaration` API; multiple exports in one Lean process.
- Portable examples and test suite covering real Lean proofs and application behavior.

Prototype schema names remain `lean-proof-tree/*/v1` for compatibility.
