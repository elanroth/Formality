# Website

The public interface is https://elanroth.github.io/formality/.

The public deployment uses `--external-runtime`: it loads compiler/library bytes
from the runtime repository's exact commit on `raw.githubusercontent.com`, while
hosting the UI, checked examples, and hash manifest on GitHub Pages. No source code
is sent to that host; execution stays in the local WebAssembly worker. This keeps
the Pages artifact small; a deployment including all 534 MB of assets timed out
while GitHub was syncing files. The default build below remains self-contained.

The same `web/` files work with the Python local API or the static browser engine.
`scripts/build-pages.mjs` selects the browser engine using a generated HTML meta
tag and materializes the pinned compiler assets. It does not commit those assets
to Formality. The personal Pages repository builds its existing homepage first,
then adds this application under `build/formality/`. Add `--external-runtime` to use the public deployment
layout instead of copying compiler/library bytes.

```sh
git clone https://github.com/live-codes/browser-lean ../browser-lean
git -C ../browser-lean checkout a8aed095534e67061e2626b94e8e69193099091d
node scripts/build-pages.mjs --runtime ../browser-lean
node scripts/serve-pages.mjs
```

Open http://127.0.0.1:8781/formality/. Serve the generated files over HTTPS in
production. The scoped COI service worker supplies isolation headers required by
shared WebAssembly memory on GitHub Pages; it may reload the page once. It only
controls `/formality/`, preserves the current editor draft before reloading,
and does not install an application cache. Libraries may be cached by the Lean SDK.

The build records SHA-256 and size for every compiler/library asset in
`lean-runtime/manifest.json`. Browser runs use the same expression extraction API,
with a direct `run_elab` adapter instead of native file output/path discovery.
The SDK performs full source parsing as well as elaboration. The generated
`browser-contract/v1` records input, configuration, compiler/runtime commits,
exporter/driver hashes, and canonical tree hash. It does not claim native replay
verification, source hermeticity, or identity with another Lean version.

The first compiler download is substantial. Core and Mathlib assets total about
534 MB in the deployed bundle; the SDK downloads libraries as needed, not the
entire bundle for every run. Foundation imports are not supported by this runtime;
its examples are previously extracted native proofs with provenance attached.

Third-party runtime source and license information is in
[`web/vendor/LEAN-WASM-NOTICES.md`](../web/vendor/LEAN-WASM-NOTICES.md).
