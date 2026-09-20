# ZKas in Kastle

ZKas is a separate shielded network. For an ordinary Kastle recovery-phrase wallet, the ZKAS asset follows the selected account index and the Kastle backup phrase also recovers its ZKas spending account. An imported Kaspa private key does not automatically become a ZKas spending seed. A phrase with a BIP39 passphrase and a Ledger wallet remain unsupported.

If you have a 32-byte ZKas spending seed in 64-character hexadecimal form, enable **Experimental features**, open **Import Wallet**, and choose **ZKas spending seed**. Compare the derived address with the address from the wallet or CLI that generated it before confirming. Kastle stores it as an independent encrypted ZKas wallet and switches to ZKas Mainnet. The full-page import ends at **Accounts Imported**; choose **Back to extension** to open the compact wallet dashboard. Your Kaspa recovery phrase does **not** recover this imported seed: use **Back up ZKas spending seed** and keep an offline copy. Importing the same seed twice is refused. Never paste a spending seed into the local test page or a website.

The wallet switcher follows the selected network. Kaspa Mainnet and Testnet show recovery-phrase, Kaspa private-key, and Ledger wallets with their Kaspa addresses. ZKas Mainnet shows eligible recovery-phrase accounts with `zkas:` addresses and imported ZKas spending-seed wallets. Selecting a wallet does not change the network. Importing a Kaspa private key while viewing ZKas switches back to Kaspa; importing a ZKas seed switches to ZKas Mainnet. Existing Kaspa private-key wallets with a ZKas seed attached by earlier builds remain available on ZKas; the new import flow creates a separate wallet. Ledger and phrase-with-passphrase wallets are unavailable on ZKas. The address dropdown and receive screen derive the selected ZKas address locally without querying the daemon. Open the ZKAS asset screen to read its synced balance.

The [current upstream CLI guide](https://github.com/firecash/zkas-rusty/blob/main/docs/CLI-WALLET.md) describes `shielded-pay` as a testing tool and does not document a `new` command. Check the version you installed and confirm that its output is a real 32-byte spending seed and that Kastle derives the expected address. Do not use a CLI test seed to hold funds.

## Set up a wallet daemon

1. Run a compatible `zkas-walletd` with complete shielded history. A mining-only or history-pruned node cannot establish a final balance. See [upstream walletd documentation](https://github.com/firecash/zkas-rusty/blob/main/docs/WALLETD.md).
2. Unlock Kastle, enable **Settings → Experimental features**, then choose **ZKas Mainnet · Experimental** under **Settings → Network**. Use the wallet switcher to select an eligible recovery-phrase account or imported ZKas seed wallet. The dashboard switches to ZKAS. Open **Configure ZKas daemon**.
3. Enter the walletd URL and approve the browser's host permission prompt. Use HTTPS for a remote daemon, or `http://localhost` / `http://127.0.0.1` for a local one. Kastle does not choose a hosted daemon automatically.
4. Wait for the asset screen to show a synced shielded balance. Receive uses the ZKas address shown there or its QR code. Before a send, review the recipient, amount, and maximum fee; keep the Kastle window open during proof preparation.

The daemon receives the full viewing key and a wallet-scoped token, and can observe the account's shielded activity. It does not receive the phrase, spending seed, or signing key. Kastle's pinned signer checks the recipient, amount, and actual fee encoded in the prepared bundle before returning signatures. The daemon's fee number shown after a send is its report; the signer verifies the maximum fee ceiling.

If a submit response is lost, the payment may already have been broadcast. Open **ZKAS → Recent activity** and reconcile the transaction ID and pending sends before trying again. Kastle keeps a recovery warning across popup and browser restarts and blocks another send for that account until you explicitly clear it. An interrupted preparation can also leave a conservative warning; active requests must finish or time out before the warning can be cleared. History depends on the daemon's recoverable-history setting and sync state.

## Network and release limits

- The network picker exposes ZKas Mainnet only while Experimental features is enabled. Turning the toggle off returns the dashboard to Kaspa Mainnet and blocks ZKas account, balance, and payment requests, including if another open extension window later saves older settings. Selecting a Kaspa network also leaves ZKas. ZKas testnet is not selectable in this version because the pinned signer cannot authorize its payments.
- The first send flow authorizes one full payment transaction. A fragmented payment that requires partial delivery is refused before signing.
- A funded mainnet send, a compatible walletd, and independent upstream signer audit are outstanding release checks. No live transaction is exercised by the automated test suite.
- The upstream signer WASM and JS glue are pinned by SHA-256 and checked at build and packaging time. Verify upstream redistribution licensing before publishing an extension build that contains them.

Technical provenance and security tests are tracked in [the feature design](ai/design/2026-09-19-feature-zkas-support.md) and [test plan](ai/testing/2026-09-19-feature-zkas-support.md).

## Local website test

Build and load `.output/chrome-mv3` as an unpacked extension. From the repository root, run `python3 -m http.server 4173 --directory devtools/zkas-test` and open `http://localhost:4173`. Enable Experimental features and select ZKas Mainnet in the extension before using the ZKas probes. The page detects the installed Kastle provider, probes the existing Kaspa API, and can request a separate ZKas connection. After approval, it reads the selected ZKas public address and shielded balance/sync status. The page never receives the recovery phrase, full viewing key, or daemon token.

The grant is specific to the website origin, selected Kastle wallet/account, and ZKas network. Disconnect a site under **ZKAS → Configure ZKas daemon → Connected websites**. Only HTTPS sites and HTTP loopback development sites can request ZKas access. A payment request always opens a separate review screen and requires a fresh approval.

The browser provider methods are `window.kastle.request("zkas:connect")`, `zkas:get_account`, `zkas:get_balance`, and `zkas:send`. The payment method takes `{ to, amountSompi, maxFeeSompi }`, where both amounts are positive decimal integer strings in sompi (100,000,000 sompi per ZKAS). It resolves after the separate payment window submits with `{ txid, daemonReportedFeeSompi }`. If the window closes or the outcome is uncertain, the page receives an error and the user should reconcile Kastle activity before retrying. The local test page converts its ZKAS decimal inputs exactly to sompi.
