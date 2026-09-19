# ZKas signer provenance

The executable JavaScript and WASM files are copied without modification from
[`firecash/zkas-wallet` commit `ae576a86a47df0e52ab0fdf7f1103ba818b09609`](https://github.com/firecash/zkas-wallet/tree/ae576a86a47df0e52ab0fdf7f1103ba818b09609/src/signer):

- `firecash_signer.js`
- `firecash_signer.d.ts` (two trailing spaces in comments removed)
- `firecash_signer_bg.wasm`
- `firecash_signer_bg.wasm.d.ts`

The upstream signer source is
[`firecash/zkas-signer` commit `44209c7f9b7ada554a40b633a8025888f625418f`](https://github.com/firecash/zkas-signer/tree/44209c7f9b7ada554a40b633a8025888f625418f).
Its `Cargo.toml` declares `MIT OR Apache-2.0`. The binary SHA-256 is
`ea0ec55a2cef0bb7f3cd6ce80b0e5c218693e0e97be49c80a73587b1eefcd409`,
matching the source README's reproducible-build value. The source repository
does not include license text files; verify redistribution terms before release.

The executable JavaScript glue SHA-256 is
`95df21bdeab1d9ff56c2bf1a7dc8d733435dceeff0bd83ae60aa39f88d3f08db`.

`npm run check:zkas-signer` verifies both executable hashes, embedded ZKas mainnet
genesis, and that the generated JS glue supplies every WASM import. Do not
replace the WASM or glue independently. Rebuild both from the same pinned
source/toolchain and update the hash, genesis check, and vectors together.
The runtime wrapper also checks the WASM SHA-256 before initialization, including
when the caller supplies bytes or an asset URL.
