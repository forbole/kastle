# ZKas signer provenance

The JavaScript glue and WASM in this directory were built together from
[`firecash/zkas-signer` commit `44209c7f9b7ada554a40b633a8025888f625418f`](https://github.com/firecash/zkas-signer/tree/44209c7f9b7ada554a40b633a8025888f625418f),
with [`memo-verifier.patch`](memo-verifier.patch) applied. The source's sibling
`../rusty-kaspa` path dependencies were taken from
[`firecash/zkas-rusty` commit `f16b8cd8853bb54225099597542b8bcaffd4fff4`](https://github.com/firecash/zkas-rusty/tree/f16b8cd8853bb54225099597542b8bcaffd4fff4)
and extracted into a sibling directory named `rusty-kaspa`. The included
[`Cargo.lock`](Cargo.lock) locks the registry dependencies generated for this
build. The sibling revision is inferred from its proximity to the signer
commit, **not** proven to be the dependency revision of the former binary.

The patch adds an export that reconstructs Orchard v2 recipient encryption
from the disclosed note and checks the exact 512-byte zero-padded UTF-8 memo,
ephemeral key, recipient, amount, and fee before returning any signatures.
Kastle always calls this export, including with an empty memo. It retains the
old export for compatibility with other consumers but does not use it.

Rebuild in an isolated directory using the pinned source archives or checkouts:

```sh
# Layout: ./zkas-signer and ./rusty-kaspa at the pinned revisions above.
cd zkas-signer
git apply --unidiff-zero /path/to/kastle/wasm/zkas-signer/memo-verifier.patch
cp /path/to/kastle/wasm/zkas-signer/Cargo.lock .
wasm-pack build --target web --release --out-dir pkg-memo --locked
# Compare all four pkg-memo/firecash_signer* outputs with this directory.
```

This build used `rustc 1.97.1` and `wasm-pack 0.13.0`, with wasm-bindgen
`0.2.100`. The local native `cargo test --offline --locked memo_` passed the
memo verifier tests. A synthetic bundle test exercises the generated WASM
export with a spend authorization request; its absent proof and synthetic
action cannot validate funded mainnet signing or broadcast.

The patch uses zero context to avoid whitespace-only changes to generated
source. `--unidiff-zero` is required: a plain `git apply` can place additions
at the end of a file without an error. Check the exact pinned source revisions
and inspect the resulting source before building.

SHA-256:

| File | Digest |
| --- | --- |
| `firecash_signer_bg.wasm` | `89e75959878d113154212fa901e6599b21d4a3823ac12fbd92287d4be6a23914` |
| `firecash_signer.js` | `eb096ca6c0433f80535042fec69d532f67f9555b7c41d5b557b3f035cf626b14` |
| `memo-verifier.patch` | `8eb1270c636ecd2896df942f42b02af9f849800f6f3616837f95874c2600b41b` |
| `Cargo.lock` | `e26db425b32d13a9bf2059a4508fb54b17b5c69bc16b1c566caac3a3f06695d5` |

The previous binary copied from `firecash/zkas-wallet` commit
`ae576a86a47df0e52ab0fdf7f1103ba818b09609` had WASM SHA-256
`ea0ec55a2cef0bb7f3cd6ce80b0e5c218693e0e97be49c80a73587b1eefcd409`.
An unmodified local rebuild using the inferred sibling revision produced a
different hash. Thus this source reconstruction has matching account/address
vectors but **not byte-identical provenance for the previous artifact**. An
independent source/dependency review and a funded walletd integration test
remain release checks. The upstream signer declares `MIT OR Apache-2.0` in
`Cargo.toml` but has no license text file; verify redistribution terms before
publishing.

`npm run check:zkas-signer` checks the executable hashes, embedded mainnet
genesis, memo export, and WASM imports. The runtime also hashes the WASM before
initialization. Never replace the WASM and glue independently.
