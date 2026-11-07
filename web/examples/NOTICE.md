# Checked example data

These files are exports of actual kernel-checked Lean proofs, not hand-authored trees.
The `fixture` field records source links and the producing Formality version.
`godel-0.json`, `godel-1.json`, and `godel-2.json` come from
FormalizedFormalLogic/Foundation commit 63bfd1b2e821dc2367b08f68d379303d08631f83,
module Foundation.FirstOrder.Incompleteness.First, declaration
FFL.FirstOrder.Arithmetic.incomplete, Lean 4.35.0. The theorem assumes a
Δ₁-definable, Σ₁-sound extension of R₀. Credit: the Foundation contributors.
Foundation is Apache-2.0 licensed; its license is included here.
The remaining examples come from Formality's MIT-licensed bundled Lean sources.
Full extraction conventions and trust limits are described in SPEC.md and docs/GODEL.md.
