# Private ZKas batch signer SDK

These four files are the unmodified `wasm-bindgen` 0.2.100 web release output of ZKas source revision `2bdd5af9032c07273a67a607669fb288ab1435af`, built with Rust 1.98.1, `--offline --locked --release --target wasm32-unknown-unknown`. Source and artifact hashes are in `BUILD-PROVENANCE.json`; `scripts/check-zkas-batch-signer.mjs` enforces the four artifact hashes before extension packaging.

| File | SHA-256 |
| --- | --- |
| `zkas_browser_signer.js` | `d666299a34d206e9f72d9b96ea18a9cdb815fe35198e26823a510c4543a731b6` |
| `zkas_browser_signer.d.ts` | `bef19c4fe8d433cbc123ca3ba1662b5f331561d63b313ee2e8fe16f5aab98676` |
| `zkas_browser_signer_bg.wasm` | `390de75c80ea88159e6f47f8e5747bf3d75a504106beb2b99d2a3605c5885261` |
| `zkas_browser_signer_bg.wasm.d.ts` | `8fb86485f60f72cb1d4980c3eda3152e7bc2c04f5805d410ada590f96e85a3d6` |

The private adapter imports only `PrivateAccountSigner` and `initSync`; it does not return the module namespace, seed, or viewing key. The future wallet factory must independently establish selected account, origin, daemon, grant, and popup approval fences. Public dummy fixture tests prove local signatures and verification, not a live payment or broadcast.
