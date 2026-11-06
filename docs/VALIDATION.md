# Release validation

Formality 0.3.0 was checked on macOS with Lean 4.35.0, Python 3.15,
Node.js, and Google Chrome before public repository creation.

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
# 56 tests passed
node --test tests/layout.test.mjs
# 4 tests passed
```

The Python suite contains 24 distinct actual Lean proof/transform cases, plus
real extraction/locked-replay integration, request validation, and loopback HTTP
checks. HTTP tests mock extraction to test the protocol independently; proof
integration tests invoke the real compiler. These are 60 test cases, not 60
different Lean theorem inputs.

Additional checks:

- Built a wheel and installed it into a virtual environment. From outside the
  source checkout, imported `formality`, extracted a kernel-checked identity
  proof, and invoked the installed `formality --help` command.
- Ran `tests/browser.cjs` against a fresh local release server in Chrome. It
  generated Hilbert-calculus soundness and concrete induction, saved SVG/PNG,
  preserved the previous tree on invalid Lean input, checked widths 320/736/1440,
  and rejected a POST without the local session token.
- The suite's strict replay test used two fresh Lean processes and compared
  canonical tree and SVG bytes. It also tested lock mismatch reporting.
- Generated `docs/cantor.svg` from `Diagonal.cantor` with
  `Diagonal.selfContradiction` expanded: 247 nodes, no truncation, no axioms.
  Inspected the browser rendering and reviewed public files for local paths.

[The initial public CI run](https://github.com/elanroth/Formality/actions/runs/42264095007)
passed both matrix jobs. CI runs the same automated suites on Ubuntu with Python 3.10 and 3.13, Node 22,
and the pinned Lean toolchain, followed by wheel installation and API use
outside the checkout. This is finite implementation evidence, not a theorem
about all Lean programs or proof-tree correctness. The browser check is local;
it is not part of the hosted CI job.

## 0.4.0 expansion update

The updated suite passed 60 Python tests plus four Node layout tests. New cases
cover repeated-proof expansion history, structural binder names, open local contexts,
and transformation-budget validation. The updated wheel was installed separately;
its API and browser controls are checked independently. The actual Foundation
incompleteness run is documented in [GODEL.md](GODEL.md); that external dependency
benchmark is not part of the lightweight CI suite.
