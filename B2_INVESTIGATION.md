# B2 — KAS send near-full-balance broadcasts wrong transaction

**Base:** `forbole/kastle` `main` @ `344e63f`
**Date:** 2026-08-27
**Verdict: CONFIRMED.** The suspected mechanism is exactly right and is reproduced
deterministically offline, with no network and no wallet required.

---

## Verdict in one paragraph

`createTransactions` is the WASM `Generator` in one shot. When the sender's UTXO set
is fragmented enough that the inputs needed to cover the requested amount would exceed
the maximum transaction mass, the Generator emits a **daisy-chained batch**: one or
more _compound_ transactions that sweep selected UTXOs into the change address, and
then the real payment as the **last** element of the returned array.
`ConfirmStep.tsx:89` takes `transactions[0]` and nothing else, so on a fragmented
wallet Kastle signs and broadcasts a **compound transaction that pays the sender's own
change address**, reports success, and never broadcasts the payment. The fee is real
and is paid. The recipient gets nothing. Splitting the send into smaller amounts works
because fewer inputs are needed, so the batch collapses to a single transaction.

---

## Q1 — Does this SDK version document multi-transaction output? **Yes, explicitly.**

`wasm/core/kaspa.d.ts:5586-5595`, the `Generator` class doc comment:

> Generator is a type capable of generating transactions based on a supplied
> set of UTXO entries or a UTXO entry producer (such as {@link UtxoContext}). The Generator
> accumulates UTXO entries until it can generate a transaction that meets the
> requested amount **or until the total mass of created inputs exceeds the allowed
> transaction mass, at which point it will produce a compound transaction by forwarding
> all selected UTXO entries to the supplied change address and prepare to start generating
> a new transaction. Such sequence of daisy-chained transactions is known as a "batch".**
> Each compound transaction results in a new UTXO, which is immediately reused in the
> subsequent transaction.

The documented consumption pattern for the `Generator` is a loop
(`wasm/core/kaspa.d.ts:5613-5617`):

```javascript
let pendingTransaction;
while ((pendingTransaction = await generator.next())) {
  await pendingTransaction.sign(privateKeys);
  await pendingTransaction.submit(rpc);
}
```

`createTransactions` is the batched form of that loop. Its return type
(`wasm/core/kaspa.d.ts:4815-4829`) is:

```ts
export interface ICreateTransactions {
  /** Array of pending unsigned transactions. */
  transactions: PendingTransaction[];
  /** Summary of the transaction generation process. */
  summary: GeneratorSummary;
}
```

And the "final transaction" concept the task suspected does exist — on the summary
(`wasm/core/kaspa.d.ts:5650-5670`, `GeneratorSummary`):

```ts
readonly finalTransactionId: string | undefined;
readonly finalAmount: bigint | undefined;
readonly transactions: number;
```

`finalAmount` / `finalTransactionId` describe the **last** transaction — the actual
payment. `transactions` is the batch length. The SDK's own vocabulary distinguishes
the final transaction from the compound ones; the code ignores the distinction and
takes index 0.

## Q2 — Reproduction. `transactions.length` is 3, 4, 6, 13 …

No network needed. `createTransactions` takes `entries` as a plain array, so a
fragmented UTXO set can be synthesised directly against the shipped
`assets/kaspa_bg.wasm`. Fixture mirrors Leo's ratio exactly: **total 3005 KAS, request
3000 KAS**, varying only how many UTXOs the 3005 is split across.
The scratch script that produced the table below was a sweep over UTXO counts; its
assertions are now folded into `tests/kas-send-batch-unit.spec.ts`, which ships with
the fix.

Verbatim output from that sweep, captured before the fold. The equivalent assertions
now run via `./node_modules/.bin/playwright test tests/kas-send-batch-unit.spec.ts --reporter=line` (exit 0):

```text
count=1    each=3,005          transactions.length=1  summary.transactions=1
  tx[0] inputs=1   outputs=[3,000KAS->DEST | 4.997964KAS->SENDER]

count=10   each=300.5          transactions.length=1  summary.transactions=1
  tx[0] inputs=10  outputs=[3,000KAS->DEST | 4.987902KAS->SENDER]

count=84   each=35.77380952    transactions.length=1  summary.transactions=1
  tx[0] inputs=84  outputs=[3,000KAS->DEST | 4.90516968KAS->SENDER]

count=88   each=34.14772727    transactions.length=1  summary.transactions=1
  tx[0] inputs=88  outputs=[3,000KAS->DEST | 4.90069776KAS->SENDER]

count=89   each=33.76404494    transactions.length=3  summary.transactions=3
  tx[0] inputs=88  outputs=[2,971.13655272KAS->SENDER]     <-- what Kastle broadcasts
  tx[1] inputs=1   outputs=[33.76232094KAS->SENDER]
  tx[2] inputs=2   outputs=[3,000KAS->DEST | 4.89571966KAS->SENDER]   <-- the payment

count=100  each=30.05          transactions.length=3  summary.transactions=3
  tx[0] inputs=88  outputs=[2,644.300598KAS->SENDER]       <-- what Kastle broadcasts
  tx[1] inputs=12  outputs=[360.585978KAS->SENDER]
  tx[2] inputs=2   outputs=[3,000KAS->DEST | 4.883422KAS->SENDER]

count=200  each=15.025         transactions.length=4
  tx[0] inputs=88  outputs=[1,322.100598KAS->SENDER]
  tx[1] inputs=88  outputs=[1,322.100598KAS->SENDER]
  tx[2] inputs=24  outputs=[360.572562KAS->SENDER]
  tx[3] inputs=3   outputs=[3,000KAS->DEST | 4.769486KAS->SENDER]

count=400  each=7.5125         transactions.length=6   (5 compounds, then the payment)
count=1000 each=3.005          transactions.length=13  (12 compounds, then the payment)
```

Answers to the specific questions asked:

- **Is `transactions[0]` really a small/partial amount to the sender's own address?**
  Yes. In every batched case `tx[0]` has a **single output paid to SENDER**, never to
  DEST. `DEST` appears only in the last transaction. The `->SENDER` / `->DEST`
  labelling above is a byte comparison of each output's `scriptPublicKey` against
  `payToAddressScript(sender)` and `payToAddressScript(dest)`, not an inference.
- **Threshold.** The break is between **88 and 89 inputs** for this shape: 88 inputs
  still fit one transaction, 89 forces a batch. That is why the bug is "intermittent"
  and "only above ~1000 KAS" — it is not amount-dependent at all, it is
  _input-count_-dependent, and a wallet only accumulates ~90 UTXOs after a lot of
  activity. Leo's workaround (split into smaller sends) works because a smaller
  amount needs fewer inputs, so the batch collapses to length 1.
- **The batch is ordered and chained.** `tx[1]` spends `tx[0]`'s output, `tx[2]` spends
  `tx[1]`'s. They must be submitted in array order; each parent must be in the mempool
  before its child. This is the "daisy-chained" wording from the Q1 doc quote.
- **`summary.finalAmount` is `300000000000` (3000 KAS) in every batched case** — the
  SDK knew all along what the payment was; the code just never reached it.

## Q3 — The other `createTransactions` consumers

Six call sites outside `wasm/` and the test suite:

| File                                                        | Handling                                                                                                                                           | Same bug?                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/background/handlers/kaspa/buildTransaction.ts:167-197` | `pendingTxs.map(...)` — serializes **all** of them, with the comment _"Serialize all pending transactions (may be multiple for UTXO compounding)"_ | **No.** Correct.                                                                                                                                                 |
| `api/background/handlers/kaspa/sendSompi.ts:126-155`        | `const pendingTx = pendingTxs[0]`                                                                                                                  | **Yes**, same index-0 truncation.                                                                                                                                |
| `api/background/handlers/kaspa/compoundUtxos.ts:104-128`    | `const pendingTx = pendingTxs[0]`                                                                                                                  | **Yes**, same index-0 truncation.                                                                                                                                |
| `components/send/kas-send/ConfirmStep.tsx:77-92`            | `transactions[0].transaction`                                                                                                                      | **Yes** — this is the reported bug.                                                                                                                              |
| `lib/commit-reveal.ts:121-135, 165-176`                     | `pendingTxs[0]` / `revealPendingTxs[0]`                                                                                                            | **Yes** in principle (KRC-20 commit/reveal).                                                                                                                     |
| `hooks/useKasFeeEstimate.ts:33-40`                          | `transactions[0].feeAmount`                                                                                                                        | **Yes**, but as a _fee under-estimate_: it reports only the first transaction's fee, so the quoted fee is wrong for a batched send. Not a wrong-transaction bug. |

**`compoundUtxos.ts` is not the reference implementation the task hoped for** — it has
the same `[0]`-only truncation. `buildTransaction.ts` is the one that got it right, and
it is the only one that already carries a comment showing the author knew about UTXO
compounding. So the intended pattern exists in the codebase; it just wasn't applied to
the internal Send path.

**Why the two single-transaction popup handlers are not fixed in the same pass** (despite sharing
the `[0]` index): their _shape_ differs from ConfirmStep's, so it is not the same fix.
Neither handler signs anything itself — each serializes **one** transaction into
`SignTxPayloadSchema` and hand it to the `/sign-and-broadcast-tx` popup, which is a
single-transaction UI and protocol. Fixing them means changing the popup payload
schema, the popup UI, and the dApp-facing API response shape — a cross-cutting change
to the external API surface, on a different risk profile from a self-contained
component fix. `commit-reveal.ts` additionally pins `priorityEntries` and signs the
reveal input with a redeem script, so a batch there needs its own analysis.
Recommended as separate follow-ups; see `B2_SUMMARY.md`.

## Q4 — Ledger

`components/send/kas-send/ConfirmStep.tsx` takes `walletSigner?: IWalletWithGetAddress`
and calls only `signer.getAddress()` and `signer.signTx(transaction)`
(`lib/wallet/wallet-interface.ts:28`). Both `HotWalletAccount`
(`lib/wallet/account/hot-wallet-account.ts:48`) and `LedgerAccount`
(`lib/wallet/account/ledger-account.ts:112`) implement that. The component is
signer-agnostic and the fix does not need to touch `ledger-account.ts`.

**Consequence for Ledger of signing the whole batch:** `LedgerAccount.signTx` is one
device interaction per call, so an N-transaction batch is **N separate on-device
confirmations**. With the numbers above that is 3 confirmations at 89 UTXOs, 6 at 400,
13 at 1000. That is the honest cost of actually completing the payment — today the
Ledger user confirms once and the payment silently does not happen. But the compound
confirmations will look alarming on the device: they show a transfer to the user's own
change address for an amount that is not what they typed. This needs UI text before it
ships to Ledger users, and is called out in the QA checklist and as a follow-up.

## Q5 — Alternative causes

Not needed: Q2 reproduced the suspected mechanism directly and deterministically, so
the alternatives were not pursued as causes. One unrelated defect was noticed while
reading and is **not fixed here** (out of scope, different change):

- **`priorityFee: 0n` is hardcoded and silently discards the user's fee choice.**
  `DetailsStep.tsx:196` writes the selected priority (low/normal/priority) into the
  form as `priorityFee`; `ConfirmStep.tsx:42-47,187` reads it back and displays
  "`{priorityFeeKas} KAS`" to the user on the confirm screen — and then
  `ConfirmStep.tsx:85` passes `priorityFee: 0n` to `createTransactions`. The fee the
  user picked and was shown is never applied. Filed as a follow-up.

---

## GATE: **CONFIRMED** → proceed to Part 2

Mechanism is `transactions[0]`-only truncation of a Generator batch, evidenced by the
SDK's own documentation (Q1) and by deterministic offline reproduction against the
shipped WASM binary (Q2), with the compound-to-self output verified by
`scriptPublicKey` byte comparison rather than assumed.
