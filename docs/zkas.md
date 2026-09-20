# Experimental ZKas support

Kastle can manage ZKas shielded accounts alongside its existing Kaspa wallets. The feature is available on **ZKas Mainnet** only after **Experimental features** is enabled. ZKas has its own `zkas:` address format, balance, wallet daemon, and payment flow. Kaspa Mainnet and Testnet continue to use the existing Kaspa wallet flow.

## Choose a network and wallet

1. Unlock Kastle and turn on **Settings → Experimental features**.
2. Open **Settings → Network** and select **ZKas Mainnet · Experimental**.
3. Open the wallet switcher and select a recovery-phrase account or imported ZKas spending-seed wallet. The dashboard shows its `zkas:` address and the ZKAS asset.
4. To return to Kaspa, select **Mainnet** or **Testnet T10** in the network picker. Turning off Experimental features returns the dashboard to Kaspa Mainnet and blocks ZKas requests.

The wallet switcher follows the selected network. Switching wallets does not silently change networks.

| Selected network             | Wallets in the switcher                                                                                        | Address shown                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Kaspa Mainnet or Testnet T10 | Recovery phrase, imported Kaspa private key, and Ledger                                                        | Kaspa address for the selected network |
| ZKas Mainnet                 | Eligible recovery-phrase accounts, imported ZKas spending seeds, and legacy wallets with an attached ZKas seed | `zkas:` shielded address               |

### Wallets and backups

ZKas is a separate shielded network. For an ordinary Kastle recovery-phrase wallet, the ZKAS asset follows the selected account index and the Kastle backup phrase also recovers its ZKas spending account. An imported Kaspa private key does not automatically become a ZKas spending seed. A phrase with a BIP39 passphrase and a Ledger wallet remain unsupported.

If you have a 32-byte ZKas spending seed in 64-character hexadecimal form, enable **Experimental features**, open **Import Wallet**, and choose **ZKas spending seed**. Select **Show derived address** and compare the preview with the address from the wallet or CLI that generated the seed before choosing **Import this ZKas seed**. Kastle stores it as an independent encrypted ZKas wallet and switches to ZKas Mainnet. The full-page import ends at **Accounts Imported**; choose **Back to extension** to open the compact wallet dashboard. Your Kaspa recovery phrase does **not** recover this imported seed: use the password-gated **Back up ZKas spending seed** view and keep an offline copy. Removing the wallet without that backup can make its funds unrecoverable. Importing the same seed twice is refused, including one attached by an earlier Kastle build. Never paste a spending seed into the local test page or a website.

An ordinary recovery phrase derives a ZKas spending account at each supported account index; the same phrase backs up those accounts. An imported ZKas spending seed supports account 0 only. Importing a 32-byte value as a Kaspa private key while viewing ZKas switches back to Kaspa and does not create a ZKas wallet. Importing those same bytes as a ZKas seed derives a separate ZKas identity and switches to ZKas Mainnet; compare its previewed address before confirming. The address dropdown and receive screen derive the selected ZKas address locally without querying the daemon. Open the ZKAS asset screen to read its synced balance.

The [current upstream CLI guide](https://github.com/firecash/zkas-rusty/blob/main/docs/CLI-WALLET.md) describes `shielded-pay` as a testing tool and does not document a `new` command. Check the version you installed and confirm that its output is a real 32-byte spending seed and that Kastle derives the expected address. Do not use a CLI test seed to hold funds.

## Set up a wallet daemon

Kastle has no default ZKas daemon. A compatible [`zkas-walletd`](https://github.com/firecash/zkas-rusty/blob/main/docs/WALLETD.md) connects to a ZKas full node over its configured node RPC, scans shielded notes, maintains witnesses, prepares proofs, and submits signed payments to the network. Kastle talks to walletd over its wallet API; the extension does not directly contact the full node for shielded transactions.

1. Run a compatible `zkas-walletd` with complete shielded history and point its `--rpc-server` setting to a ZKas full node. A mining-only or history-pruned node cannot establish a final balance. See [upstream walletd documentation](https://github.com/firecash/zkas-rusty/blob/main/docs/WALLETD.md).
2. Unlock Kastle, enable **Settings → Experimental features**, then choose **ZKas Mainnet · Experimental** under **Settings → Network**. Use the wallet switcher to select an eligible recovery-phrase account or imported ZKas seed wallet. The dashboard switches to ZKAS. Open **Configure ZKas daemon**.
3. Enter the walletd URL and approve the browser's host permission prompt. Use HTTPS for a remote daemon, or `http://localhost` / `http://127.0.0.1` for a local one. Kastle does not choose a hosted daemon automatically.
4. When Kastle first reads the selected account's state, it registers that account's full viewing key with walletd if needed. Reopen the ZKAS asset screen to refresh its status while walletd syncs; it does not poll automatically. Continue only when **Shielded balance synced** appears. A syncing or incomplete-history warning means the balance is not final and sending stays disabled. Receive uses the ZKas address shown there or its QR code.

The daemon receives the full viewing key and a wallet-scoped token, and can observe the account's shielded activity. It does not receive the phrase, spending seed, or signing key. Kastle uses walletd's watch-only `prepare` and `submit` path, not its custodial seed-import or send endpoints. Kastle's pinned signer checks the recipient, amount, and actual fee encoded in the prepared bundle before returning signatures. The daemon's fee number shown after a send is its report; the signer verifies the maximum fee ceiling.

## Receive and send

**Receive** shows the selected `zkas:` address and QR code even before the daemon has synced. Verify the selected network and wallet before sharing it. A daemon is required for balance and recent activity.

For a payment, open **ZKAS → Send**, enter a mainnet ZKas recipient, an amount in ZKAS, and the maximum fee you approve. Review the source address, recipient, amount, and fee ceiling before choosing **Confirm and send**. Keep the Kastle window open while walletd prepares the proof. Kastle requires a synced daemon with complete history and enough reported balance. It refuses a partial prepared payment. After local verification and signing, walletd submits the signed transaction through its node connection. The result shows a transaction ID and the daemon-reported fee.

**Maximum fee** is your spending limit, not a fee suggested by Kastle or a network-wide maximum. The required fee depends on the prepared payment's size and number of shielded actions. [Upstream walletd documentation](https://github.com/firecash/zkas-rusty/blob/main/docs/WALLETD.md#fees-are-per-byte-so-per-action) currently lists a minimum relay fee of 1,855,400 sompi (0.018554 ZKAS) for one or two actions; payments using more actions can cost more. For example, a 0.0001 ZKAS ceiling is below that documented minimum. If walletd proposes a fee above your ceiling, Kastle shows the exact proposed fee and stops before signing or submitting. Review that **daemon-proposed** figure before changing your limit and retrying. The signer still verifies the fee encoded in the bundle against your new ceiling; walletd's proposal is not itself proof of the actual fee. An interrupted or uncertain submission is different: check recent activity before retrying.

If a submit response is lost, the payment may already have been broadcast. Open **ZKAS → Recent activity** and reconcile the transaction ID and pending sends before trying again. Kastle keeps a recovery warning across popup and browser restarts and blocks another send for that account until you explicitly select **I checked history; clear warning**. An interrupted preparation can also leave a conservative warning; active requests must finish or time out before the warning can be cleared. Earlier activity may be absent if the daemon has recoverable history disabled.

## Network and release limits

- The network picker exposes ZKas Mainnet only while Experimental features is enabled. Turning the toggle off returns the dashboard to Kaspa Mainnet and blocks ZKas account, balance, and payment requests, including if another open extension window later saves older settings. Selecting a Kaspa network also leaves ZKas. ZKas testnet is not selectable in this version because the pinned signer cannot authorize its payments.
- The first send flow authorizes one full payment transaction. A fragmented payment that requires partial delivery is refused before signing.
- Automated tests cover derivation, selection, keyring boundaries, daemon response validation, website grants, and payment recovery with a fake daemon. A compatible live walletd, a valid prepared mainnet bundle, a funded payment, and an independent upstream signer audit remain release checks. No funded transaction is exercised by the automated suite.
- Initialized-wallet browser checks remain for import and backup, website approval and denial, account switching, and existing Kaspa send regression. See the [test plan](ai/testing/2026-09-19-feature-zkas-support.md) for the exact recorded evidence.
- The upstream signer WASM and JS glue are pinned by SHA-256 and checked at build and packaging time. Verify upstream redistribution licensing before publishing an extension build that contains them.

Technical provenance and security tests are tracked in [the feature design](ai/design/2026-09-19-feature-zkas-support.md) and [test plan](ai/testing/2026-09-19-feature-zkas-support.md).

## Local website test

Build the extension from the repository root:

```sh
npm run build
```

In a separate Chrome test profile, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `.output/chrome-mv3` directory. After subsequent builds, use **Reload** on the extension card and refresh the test page. Use a disposable wallet for payment experiments.

Serve the test page from the repository root:

```sh
python3 -m http.server 4173 --directory devtools/zkas-test
```

Open `http://localhost:4173` in the same Chrome profile. A `file:` URL is not a supported website origin for this flow. The page detects the installed Kastle provider and **Probe installed extension** calls the existing Kaspa version API. Enable Experimental features and select ZKas Mainnet in the extension before choosing **Connect ZKas**, **Get ZKas account**, or **Get shielded balance and sync state**. After approval, the page reads the selected public address and shielded balance/sync status. It never receives the recovery phrase, full viewing key, or daemon token.

The grant is specific to the website origin, selected Kastle wallet/account, and ZKas network. Disconnect a site under **ZKAS → Configure ZKas daemon → Connected websites**. Only HTTPS sites and HTTP loopback development sites can request ZKas access. A payment request always opens a separate review screen and requires a fresh approval.

The browser provider uses `window.kastle.request(method, args)`:

| Method             | Result or action                                                          |
| ------------------ | ------------------------------------------------------------------------- |
| `zkas:connect`     | Request an origin-scoped connection to the selected ZKas account.         |
| `zkas:get_account` | Read the connected public account.                                        |
| `zkas:get_balance` | Read shielded balance and sync status from the selected daemon.           |
| `zkas:send`        | Request a fresh payment approval with `{ to, amountSompi, maxFeeSompi }`. |

Both payment amounts are positive decimal integer strings in sompi (100,000,000 sompi per ZKAS). A successful send resolves after the separate payment window submits with `{ txid, daemonReportedFeeSompi }`. If the window closes or the outcome is uncertain, the page receives an error and the user should reconcile Kastle activity before retrying. The local test page converts its ZKAS decimal inputs exactly to sompi. **Request payment approval** is optional; the page sends nothing on load, but approval can broadcast a real mainnet payment.
