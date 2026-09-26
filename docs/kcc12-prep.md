# KCC-12 provider prep

KCC-12 (Kaspa browser-wallet provider, [kaspanet/kccs#24](https://github.com/kaspanet/kccs/pull/24), Draft, tracked at `7159d48`) is **not implemented**. This note records where Kastle stands so integration is fast once it merges.

## 1. Provider shape (done)

`window.kastle` (`api/browser.ts`, injected by `entrypoints/injected.ts`) now accepts the EIP-1193 / KCC-12 call shape alongside the old one:

|                | Positional (legacy)              | Object (EIP-1193 / KCC-12)                       |
| -------------- | -------------------------------- | ------------------------------------------------ |
| Call           | `request("kas:get_network")`     | `request({ method: "kas:get_network", params })` |
| Unknown method | resolves `undefined` (unchanged) | rejects `{ code: 4200 }`                         |

Events via `on` / `removeListener`: `accountsChanged`, `networkChanged` (existing), `connect({ networkId })` (new, fires once when `content.ts` dispatches `kastle#initialized`, only if a listener is registered by then), `disconnect` (typed, **never emitted**: the background is local, so the page has no "remote lost" signal). The `kas:*` events are unchanged.

Discovery (`kaspa:announceProvider` / `kaspa:requestProvider`) is not wired. When it is, it should announce the same instance that `window.kastle` points to.

## 2. Method catalog

The positional and object `request` forms both serve the 14 `kas:*` names. Each maps 1:1 to a direct method on `window.kastle`.

| KCC-12 method                                             | Req.    | Kastle today                                                                               | Gap                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kaspa_requestAccounts`                                   | **Yes** | `kas:connect` (returns `boolean`) + `kas:get_account` (returns one `{address, publicKey}`) | Needs one call that prompts if needed and returns `Address[]`.                                                                                                                                                                                                |
| `kaspa_accounts`                                          | **Yes** | `kas:get_account`                                                                          | Rejects with a `"Host not connected"` string error when the origin is unauthorized, where the spec requires `[]` and no prompt. Its behaviour while locked is unverified; the spec requires `[]` there too. The return shape is also an object, not an array. |
| `kaspa_networkId`                                         | **Yes** | `kas:get_network`                                                                          | Values `mainnet` / `testnet-10` are already valid `NetworkId`s. Only an alias is missing.                                                                                                                                                                     |
| `wallet_requestPermissions`                               | **Yes** | none (`kas:connect` is the closest)                                                        | Missing.                                                                                                                                                                                                                                                      |
| `wallet_getPermissions`                                   | **Yes** | none                                                                                       | Missing. Per-host authorization lives in settings (`ApiUtils.isHostConnected`) but isn't exposed.                                                                                                                                                             |
| `wallet_revokePermissions`                                | **Yes** | none (`disconnect()` is a no-op)                                                           | Missing.                                                                                                                                                                                                                                                      |
| `kaspa_signMessage`                                       | No      | `kas:sign_message`                                                                         | Param shape.                                                                                                                                                                                                                                                  |
| `kaspa_sendTransaction`                                   | No      | `kas:send_sompi`                                                                           | Single output only. Fragmented UTXOs → `4300 BATCH_REQUIRED`.                                                                                                                                                                                                 |
| `kaspa_signTransaction`                                   | No      | `kas:sign_tx`                                                                              | `scripts[]` ≈ `signInputs`, but not strict. See §4.                                                                                                                                                                                                           |
| `kaspa_sendRawTransaction`                                | No      | none                                                                                       | `kas:sign_and_broadcast_tx` always signs. There is no broadcast-only path.                                                                                                                                                                                    |
| `kaspa_signPskb` / `kaspa_sendRawPskb` / `kaspa_sendPskb` | No      | none                                                                                       | No PSKB support.                                                                                                                                                                                                                                              |
| `wallet_switchNetwork`                                    | No      | `kas:switch_network`                                                                       | Alias.                                                                                                                                                                                                                                                        |

The KCC-12 table has no counterpart for 6 Kastle methods: `kas:get_version`, `kas:get_balance`, `kas:get_utxo_entries`, `kas:build_transaction`, `kas:commit_reveal` and `kas:compound_utxos`.

Other gaps:

- **Vendor names.** KCC-12 §4.1 requires vendor methods to use a reverse-domain prefix (for example `cc.kastle_getBalance`). `kas:*` does not comply. Keep them for legacy callers and add prefixed aliases.
- **Error codes** (`api/message.ts`). `INTERNAL_ERROR` is `5000`, where the spec uses `-32603`. `TIMEOUT` is `-320603`, which is not a spec code. `BATCH_REQUIRED` `4300` is unassigned in the spec. Handler errors often reach the page as plain strings (`new Error(msg)`), which carry no `code`.

## 3. Serialization: no change needed

`serializeToSafeJSON` / `deserializeFromSafeJSON` come from the vendored WASM SDK (`wasm/core/kaspa.js`, v2.0.1), not app code. A round trip of `test/fixtures/kaspacom-signtx-repro.txt` shows:

- uint64 fields are emitted as decimal strings: `amount`, `blockDaaScore`, `value`, `sequence`, `lockTime`, `gas` and `storageMass`.
- `utxo.covenantId`, `output.covenant` (`{authorizingInput, covenantId}`) and `input.computeBudget` are all emitted. `tests/signtx-unit.spec.ts` already asserts that they survive the round trip.

Two caveats:

- The `.d.ts` still types these as `bigint` and omits `covenantId` / `covenant`, so the types are stale but the runtime is correct.
- `kas:build_transaction` / `kas:get_utxo_entries` use an app-side `IUtxoEntry` shape without `covenantId`. A covenant UTXO passed in through `buildTransaction({ inputs })` loses its binding. This matters only when build-with-covenant-inputs is supported.

## 4. `signInputs` readiness: PARTIAL (hot wallet), NO (Ledger)

`kaspa_signTransaction({ signInputs })` must sign only the listed wallet inputs and leave every other input's `signatureScript` byte-for-byte unchanged.

**What already works (hot wallet, `lib/wallet/sign-script.ts`).**

- `ScriptOption { inputIndex, scriptHex?, signType? }` signs individual inputs through `createInputSignature`.
- The sighash type can be set per input. `SIGHASH_ALL` and `ANYONECANPAY` are allowed. `NONE` is refused.
- A listed input that already has a `signatureScript` is refused.
- Inputs that are neither listed nor the wallet's are left untouched. `signatureScript` round-trips as hex.

**What blocks strict `signInputs`:**

1. **Fallback over-signs** (`sign-script.ts` `signWithScripts`, the final `signTransaction(tx, [key], false)`). If any input is still unsigned after the listed ones, WASM `signTransaction` signs **every** wallet-owned P2PK input, including ones the dApp did not list. It uses `SIGHASH_ALL` and overwrites any existing `signatureScript` on those inputs.
2. **No ownership check.** `inputIndex` is checked only for being a non-negative integer. There is no upper bound and no check that the wallet owns the input.
3. **P2SH fee adjustment** (`SignAndBroadcast.tsx` `applyP2SHFeeAdjustment`). It rewrites the change output and calls `finalize()` before signing. Co-signers' `signatureScript` bytes stay identical, but their `SIGHASH_ALL` signatures become invalid.
4. **Ledger** (`lib/wallet/account/ledger-account.ts`). It rejects `scripts` outright. Its sign-and-broadcast path rebuilds the transaction in `toRpcTransaction`, which overwrites **every** input's `signatureScript` with `41<sig>01` and drops UTXOs. Co-signing on Ledger is impossible today.
5. **Every input must carry its `utxo`**, including co-signers' covenant inputs. Both signing APIs fail otherwise.

**Unconfirmed.** Rusty-kaspa's `createInputSignature` takes `input_index: u8`, so an index of 256 or more would produce an invalid signature. This comes from the upstream source. It has not been checked against the shipped `kaspa_bg.wasm`.

**Needed later:**

- Add a strict mode that skips the fallback.
- Assert that the listed inputs are wallet-owned, or come with a `scriptHex`.
- Assert that unlisted inputs are byte-identical before and after signing.
- Skip the P2SH fee adjustment when any input is already signed.
- Ledger needs per-input signing in `hw-app-kaspa`, and signatures merged into the original transaction.

## 5. Conformance vectors

`test/fixtures/kcc12-signature-scripts.json` is §7.7 vendored verbatim, plus a `source` pin. It holds:

- Version 0 P2PK, `SIGHASH_ALL` and `ALL|ANYONECANPAY`.
- Version 1 P2PK ECDSA.
- Version 8 P2SH, with 1-byte and 86-byte redeem scripts.
- Redeem-script hash mismatch, which must be rejected with `-32602`.

No test consumes the fixture yet.
