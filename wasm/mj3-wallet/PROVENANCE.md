# Private messaging wallet binding candidate

These four generated files are the unmodified release wasm-bindgen web output from the isolated MatJam wallet-binding candidate. They are not the fixture build. This integration candidate is pending independent review; it does not provide a connected wallet, approved login, history authority, or sending.

- MatJam committed base: 7f8da35bccb682120ba86f0106f8e60cd39dc0a1
- Isolated five-file candidate manifest: /tmp/mj3-auth1-bindings-candidate5-frozen-20261002.json, SHA-256 de89723509835236fa63d5bf4098127837e66c5f2e3c9475cd177a8fa7809b54
- Candidate patch SHA-256: 5be83fe09fcc22b4c316fcf56f5ac55dd678f0535ebcbdf5efa036acaefbf3d2
- Rust 1.98.1, wasm32-unknown-unknown release build, wasm-bindgen CLI 0.2.100, pinned ZKas dependency revision 2f3c06688a950efb8f1ee722ded899ea425798d4

| Bundled release file | SHA-256 |
| --- | --- |
| mj3_message_wallet_bindings.js | 1c6bdbe338c6552d1bf5b5d53f63cffd71a6ea2e7ce325a50bffcb713d96c652 |
| mj3_message_wallet_bindings.d.ts | 1123a80a77985bb5132161d951d1e2a03d75e009632d1ce075c5e27b110b3d95 |
| mj3_message_wallet_bindings_bg.wasm | 3a5d2548e7db335b057489abf13d1e2fdceb22163db7b83488493f7ad476adbf |
| mj3_message_wallet_bindings_bg.wasm.d.ts | 1c0dfe931c5967e9f4d2d17ec0d192d4a3a49f467a9357e33ff4fdac0e50454f |

The generated module also contains upstream public ZKas/Kaspa types and mutable diagnostic helpers. The private Kastle loader imports only the pinned initializer and PrivateMj3Account; it does not return the module namespace, invoke diagnostic hooks, or expose raw key, FVK, generic signing, decryption, or history methods to the page. The future key-service caller must supply actual selected-account, origin, grant, lock, and human-approval checks before using these typed primitives. Its account seed is wallet-held; public cards remain self-asserted identity and are not spend-ownership proof.
