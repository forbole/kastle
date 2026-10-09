# Private messaging wallet binding

The JavaScript and WASM files are byte-for-byte copies of the supplied MatJam
direct-action web release from reviewed commit
`cb905c03e9ba7ed1b2de565c68e299220e78f935` (Codex Security CLEAR
`c7c246b3-6dcd-4e42-b740-6ee522aaa7a1`). This integration runs only
inside Kastle's privileged background code. The declaration files came from
the action author's frozen release overlay and were checked against the Rust
exports and actual WASM controls. The reviewer's independently rebuilt WASM
passed those controls but was not byte-identical to the supplied file; the
hashes below pin the supplied files, not a reproducible-build claim.

| File | SHA-256 |
| --- | --- |
| `mj3_message_wallet_bindings.js` | `e05b4b29ef66aa5b3b880f4ebf0b977be3a4ae3e4509509b4eebe65b3c80b696` |
| `mj3_message_wallet_bindings_bg.wasm` | `8e902ca1bedbf30103a09f5bd74efc60229dcf218d11f17260ca83d3a3227259` |
| `mj3_message_wallet_bindings.d.ts` | `a544a4d081cd505a05c904a9a06498cc5355b1d2cac2c7769b0b3de3e4e0b318` |
| `mj3_message_wallet_bindings_bg.wasm.d.ts` | `41ec8940b652cc30cb2d504ed192ccecd9fca4191ed49a3f06fbe36549db1fa8` |

The private loader imports only the initializer and `PrivateMj3Account`. The
bundle does not become a page API or provide source, human approval, payment,
or full-history authority by itself.
