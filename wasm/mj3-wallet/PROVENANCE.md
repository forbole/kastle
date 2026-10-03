# Private messaging wallet binding

The JavaScript and WASM files are byte-for-byte copies of the reviewed MatJam
wallet-binding V2 web release at commit
`2b74611e6feffd054c360bcf2ac8f57c5c7013f0`. This integration runs only
inside Kastle's privileged background code. The TypeScript declaration was
manually extended for the reviewed V2 direct-session methods because that
frozen release retained only its JavaScript and WASM outputs; it is checked
against the Rust export signatures and actual WASM tests, not claimed to be a
generated V2 artifact.

| File | SHA-256 |
| --- | --- |
| `mj3_message_wallet_bindings.js` | `7f509b2a94d969d6cd9d3941dde810b130760a6b67605641839c15ba62e1f3e4` |
| `mj3_message_wallet_bindings_bg.wasm` | `3a03deb43c478c54ca7c29c3726f1f9f47142761b838e3e9bf4514c198765809` |
| `mj3_message_wallet_bindings.d.ts` | `cfa13fbe444935fbb946c690ce8550c428b3ef256ea00c3b2ef3a5b07f5d6a07` (manual V2 extension) |
| `mj3_message_wallet_bindings_bg.wasm.d.ts` | `1c0dfe931c5967e9f4d2d17ec0d192d4a3a49f467a9357e33ff4fdac0e50454f` (earlier generated raw exports) |

The private loader imports only the initializer and `PrivateMj3Account`. The
bundle does not become a page API or provide source, approval, payment, or
full-history authority by itself.
