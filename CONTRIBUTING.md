# Contributing

Use the pinned `lean-toolchain`, Python 3.10+, and Node.js 20+. Run the Python
unittest suite and Node layout tests from README.md before submitting a pull request.

For a bug report, include the tool version, Lean toolchain, minimal Lean source or
public module/declaration, extraction settings, expected behavior, and diagnostics.
Review generated evidence for private source and paths before attaching it.

The extraction semantics and canonicalization rules are part of the public contract.
Changes to them require a specification/version decision and regression coverage.
Do not silently change the meaning of an existing tree specification or claim full
kernel derivations from an expression traversal. Preserve explicit axiom and
truncation reporting. New rule categories also need renderer and palette support.

The Lean core, Python orchestration, and JS renderer can be changed independently,
but a release must exercise their integration and installation outside the checkout.
