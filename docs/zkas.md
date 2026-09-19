# ZKas in Kastle

ZKas is a separate shielded network. The ZKAS asset follows the selected Kastle recovery-phrase wallet and account index. The normal Kastle backup phrase also recovers the ZKas spending account. A phrase with a BIP39 passphrase, an imported private-key wallet, and a Ledger wallet are currently unsupported and fail before key derivation.

## Set up a wallet daemon

1. Run a compatible `zkas-walletd` with complete shielded history. A mining-only or history-pruned node cannot establish a final balance. See [upstream walletd documentation](https://github.com/firecash/zkas-rusty/blob/main/docs/WALLETD.md).
2. Unlock Kastle, select the intended recovery-phrase account and Kaspa mainnet, and open **ZKAS → Configure ZKas daemon**.
3. Enter the walletd URL and approve the browser's host permission prompt. Use HTTPS for a remote daemon, or `http://localhost` / `http://127.0.0.1` for a local one. Kastle does not choose a hosted daemon automatically.
4. Wait for the asset screen to show a synced shielded balance. Receive uses the ZKas address shown there or its QR code. Before a send, review the recipient, amount, and maximum fee; keep the Kastle window open during proof preparation.

The daemon receives the full viewing key and a wallet-scoped token, and can observe the account's shielded activity. It does not receive the phrase, spending seed, or signing key. Kastle's pinned signer checks the recipient, amount, and actual fee encoded in the prepared bundle before returning signatures. The daemon's fee number shown after a send is its report; the signer verifies the maximum fee ceiling.

If a submit response is lost, the payment may already have been broadcast. Open **ZKAS → Recent activity** and reconcile the transaction ID and pending sends before trying again. Kastle keeps a recovery warning across popup and browser restarts and blocks another send for that account until you explicitly clear it. An interrupted preparation can also leave a conservative warning; active requests must finish or time out before the warning can be cleared. History depends on the daemon's recoverable-history setting and sync state.

## Network and release limits

- The pinned signer supports mainnet payment authorization. Testnet accounts are read/receive only until an upstream testnet genesis is pinned and independently tested.
- The first send flow authorizes one full payment transaction. A fragmented payment that requires partial delivery is refused before signing.
- A funded mainnet send, a compatible walletd, and independent upstream signer audit are outstanding release checks. No live transaction is exercised by the automated test suite.
- The upstream signer WASM and JS glue are pinned by SHA-256 and checked at build and packaging time. Verify upstream redistribution licensing before publishing an extension build that contains them.

Technical provenance and security tests are tracked in [the feature design](ai/design/2026-09-19-feature-zkas-support.md) and [test plan](ai/testing/2026-09-19-feature-zkas-support.md).
