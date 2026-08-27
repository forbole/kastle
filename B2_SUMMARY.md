# B2 — Fix: KAS send over a fragmented UTXO set broadcasts the wrong transaction

**Branch:** `fix/kas-send-multi-transaction` (local only — not pushed, no PR, no tag)
**Base:** `main` @ `344e63f`
**Head:** single commit on top of `344e63f` — `git log -1` on the branch
**Investigation:** `B2_INVESTIGATION.md` — gate **CONFIRMED**

---

## What was wrong

`createTransactions` wraps the WASM `Generator`, which returns a **daisy-chained
batch** whenever the sender's UTXO set is too fragmented for the requested amount to
fit inside one transaction's mass budget: compound transactions that sweep UTXOs into
the change address first, the actual payment **last**.

`ConfirmStep.tsx` signed and broadcast `transactions[0]` and stopped. On a fragmented
wallet that is a compound transaction paying the sender's own change address — a real
fee is charged, the UI reports success, and the recipient is never paid.

Measured threshold (offline, against the shipped `assets/kaspa_bg.wasm`): **88 inputs
fit one transaction, 89 force a batch**. The bug is input-count-dependent, not
amount-dependent, which is exactly why it read as "intermittent, only above ~1000 KAS"
and why splitting into smaller sends worked around it.

## The fix

`lib/wallet/transaction-batch.ts` (new, 45 lines) — `signAndSubmitBatch()` signs and
submits **every** transaction the Generator returned, in array order (each one spends
the previous one's output, so the order is load-bearing), and returns all ids.

`components/send/kas-send/ConfirmStep.tsx` calls it instead of indexing `[0]`.

The loop was extracted rather than left inline because the repo has no React test
infrastructure (no `@testing-library`, no jsdom), and a money path with a branch in it
needs a test that actually drives the code. As a pure function with `Pick<>`-typed
signer/rpc parameters it is directly testable with stubs.

Two behaviours came along because they are one line each and both matter on this path:

- **Ids are published incrementally** (`onSubmitted`), so a mid-batch failure still
  shows the user on the failure screen which transactions were broadcast — and paid
  for. Previously a failure showed nothing at all.
- **An empty batch throws** instead of dereferencing `transactions[0]` as `undefined`
  and reporting a send that never happened.

`SuccessStatus` already renders multiple ids with a count badge and opens them all in
the explorer (`components/send/SuccessStatus.tsx:78-94`), so no UI work was needed
there.

### UX addition (implemented — small and low-risk)

`ConfirmStep` shows `Optimizing your wallet (2/3)` while the compound transactions go
out, and `Sending (3/3)` on the final payment. Rendered \*\*only when the batch length is

> 1\*\*, so a normal single-transaction send is visually unchanged.

This is not cosmetic on the Ledger path. `LedgerAccount.signTx` is one device
confirmation per call, so a batch is N separate on-device approvals — 3 at 89 UTXOs,
13 at 1000. Without a counter the user sees "Please approve on Ledger" repeat with no
indication of how many remain, and unplugging mid-batch leaves the compound
transactions broadcast and the payment not sent.

### Diff

```
 B2_INVESTIGATION.md                      | 208 +++++++++++++++++++++++++++++++
 B2_SUMMARY.md                            | 287 +++++++++++++++++++++++++++++++
 components/send/kas-send/ConfirmStep.tsx |  27 +++-
 lib/wallet/transaction-batch.ts          |  45 +++++++
 tests/kas-send-batch-unit.spec.ts        | 189 +++++++++++++++++++++++++++++++
 5 files changed, 751 insertions(+), 5 deletions(-)

Source change is 3 files; the other two are this report and the investigation.
```

`ledger-account.ts` is untouched — the component takes `IWalletWithGetAddress` and
calls only `getAddress()`/`signTx()`, so the fix is signer-agnostic by construction.

## Not fixed here, and why

- **`sendSompi.ts` and `compoundUtxos.ts` carry the same `pendingTxs[0]` truncation**
  but not the same fix. Neither signs anything: both serialise **one** transaction
  into `SignTxPayloadSchema` and hand it to the `/sign-and-broadcast-tx` popup, which
  is a single-transaction UI and protocol. Fixing them means changing that payload
  schema, the popup UI, and the dApp-facing API response shape — a change to the
  external API surface, on a different risk profile from a self-contained component
  fix, and one that would have collided with the #306/#308/#312 guards. **Follow-up.**
- **`buildTransaction.ts` is already correct** — it maps over all pending transactions,
  with the comment _"Serialize all pending transactions (may be multiple for UTXO
  compounding)"_. It is the in-repo precedent for this fix.
- **`lib/commit-reveal.ts`** uses `[0]` for both commit and reveal, but pins
  `priorityEntries` and signs the reveal input with a redeem script; a batch there
  needs its own analysis. **Follow-up.**
- **`hooks/useKasFeeEstimate.ts:40`** reads `transactions[0].feeAmount`, so the fee
  quoted to the user is only the _first_ transaction's fee and understates a batched
  send — at 100 UTXOs the batch's total fee is `summary.fees` = 11,657,800 sompi
  (0.1166 KAS) across 3 transactions, while the quote reflects one of them. Wrong
  number, not a wrong transaction. **Follow-up** — worth doing soon, since users now
  actually see the batch happen. Measured, same offline harness, balance 3000 KAS:

  | UTXOs | quoted fee (`transactions[0].feeAmount`) | real batch fee (`summary.fees`) | Max button                      |
  | ----- | ---------------------------------------- | ------------------------------- | ------------------------------- |
  | 1     | 203,600                                  | 203,600                         | works                           |
  | 120   | 315,400                                  | 13,893,800                      | works                           |
  | 400+  | —                                        | —                               | **throws `Insufficient funds`** |

  The under-quote is currently harmless only because `useFindMax`'s
  `minSubtrahend: 0.3 KAS` (30,000,000 sompi) happens to exceed the real fee at 120
  UTXOs. At **≥400 UTXOs the Max button itself throws `Insufficient funds`** and the
  send cannot be made at all. **This is pre-existing, not a regression**: the throw
  comes out of `createTransactions` before any indexing, so `main` behaves identically.
  It matters for QA — fragment to ~120 UTXOs, not 400+, or the tester hits this other
  bug and misattributes it to this fix.

- **`priorityFee: 0n` is hardcoded in `ConfirmStep.tsx:90`**, discarding the priority
  the user picked in `DetailsStep.tsx:196` and which `ConfirmStep.tsx:50,193` displays
  back to them as "`{priorityFeeKas} KAS`". Unrelated defect found while reading. **Follow-up.**

---

## Gauntlet receipts

One pass, green. Every exit code below was read from `$?` on the line immediately
after the command, outside any pipe (`rtk` fabricates output, so no exit code here
comes from parsing stdout). Node 20.20.2, binaries invoked by absolute path from
`./node_modules/.bin/`.

| Gate | Command                                                                | Result                     | How verified                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1   | `./node_modules/.bin/tsc --noEmit`                                     | **0**                      | `G1_exit=0`, empty log                                                                                                                                                                                                               |
| G2a  | `./node_modules/.bin/eslint .`                                         | **0**                      | `G2_eslint_exit=0`, `39 problems (0 errors, 39 warnings)` — identical to the baseline captured on `main` before any edit (`BASELINE_eslint_exit=0`, 39 warnings)                                                                     |
| G2b  | `./node_modules/.bin/prettier --check .`                               | **0**                      | `G2_prettier_exit=0`, `All matched files use Prettier code style!`                                                                                                                                                                   |
| G3a  | `playwright test tests/signtx-unit.spec.ts --reporter=line`            | **0**                      | `G3_signtx_exit=0`, `92 passed`                                                                                                                                                                                                      |
| G3b  | `playwright test tests/kas-send-batch-unit.spec.ts --reporter=line`    | **0**                      | `G3_new_exit=0`, `7 passed`                                                                                                                                                                                                          |
| G4   | `git diff main...HEAD -- package.json package-lock.json wasm/ assets/` | **EMPTY**                  | redirected to file, `wc -c` = **0**                                                                                                                                                                                                  |
| G5   | `git diff main...HEAD -- lib/wallet/account/ledger-account.ts`         | **EMPTY**                  | redirected to file, `wc -c` = **0**                                                                                                                                                                                                  |
| G6   | guards #306/#308/#310/#312/#324/#326/#328/#330                         | **byte-identical**         | resolved each PR to its merge commit, took the union of every file those 8 commits touched (`SignAndBroadcast.tsx`, `LedgerSignTx.tsx`, `SignTx.tsx`, `ledger-account.ts`, …), diffed that whole set `main...HEAD` → `wc -c` = **0** |
| G7   | `playwright test --reporter=line`                                      | **107 passed / 1 skipped** | `G7_exit=0`. The 1 skip is `tests/qa-fragment-wallet.spec.ts` (untracked QA tooling, skips itself unless `QA_KEY` is set). No failures, no new failures.                                                                             |

### A correction to the brief

The brief states `tests/onboarding.spec.ts:7` fails deterministically (5/5) on
unmodified `main`. On this machine it is **flaky, not deterministic**: it failed one
G7 pass (105 passed / 1 failed) and passed the next two (106 passed; 107 passed after
the near-max test was added) with no change in between. Treat it as flaky.

### The new test earns its place

`tests/kas-send-batch-unit.spec.ts` — 7 tests built on a real `createTransactions`
batch (100 UTXOs totalling 3005 KAS, sending 3000 KAS, mirroring the report):

- asserts the fragmented set really does yield `length > 1`, so the scenario cannot
  silently stop testing anything;
- asserts `transactions[0]` pays the destination **nothing** — the negative control;
- asserts the **full 3000 KAS reaches the destination**, summed from the
  `scriptPublicKey` of every output actually handed to `submitTransaction`, not merely
  that no error was thrown;
- asserts broadcast order matches generator order with the payment last;
- asserts a **near-max amount** (`balance - 0.3 KAS`, the largest the Max button will
  ever submit) also delivers in full from a fragmented wallet — QA item 4, moved from
  the manual list into the suite;
- asserts an unfragmented wallet still sends exactly one transaction;
- asserts progress and incremental id callbacks fire for every transaction, and that
  an empty batch is refused.

**Mutation-checked:** reverting `signAndSubmitBatch` to the old `[0]`-only behaviour
(`transactions.slice(0, 1)`) makes **3 of the 6 then-existing tests fail**, including _"the FULL requested
amount reaches the destination"_; the mutation was reverted and the suite re-run green.
The tests fail when the bug is present.

---

## QA build

```
~/Desktop/kastle-qa-b2/          (38 MB, unpacked chrome-mv3)
```

Marked with the branch's final short sha and verified off disk after copying — read
the literal values back from `~/Desktop/kastle-qa-b2/manifest.json` (`name`,
`version`, `version_name`) rather than from this document, which is inside the commit
being identified and so cannot name its own sha.

`npm run build` exit **0**. The QA marking is applied to the built
`.output/chrome-mv3/manifest.json` only — it is not in the source diff, so G4/G5/G6
stay empty.

> Load it in a **separate Chrome profile**. Two Kastle builds in one profile race to
> inject `window.kastle` and the results are not trustworthy.

## Manual QA — the short path

Real money, real network. **Step 1, the reported failure, has now been run end-to-end on
testnet-10 and passed** (details below). Steps 2 and 3 remain. Two of the four originally-listed items have
since been answered offline; what is left is **one funded testnet-10 address and about
fifteen minutes**, plus the Ledger pass if a device is available.

### Step 0 — fragment a testnet-10 address (done)

Doing this through the UI is impractical: Send writes a single output, so reaching 89
UTXOs would take 89 sends. `tests/qa-fragment-wallet.spec.ts` (untracked QA tooling,
deliberately not part of the fix) does it:

```
QA_KEY=<hex private key of a funded testnet-10 address> QA_TARGET=95 \
  ./node_modules/.bin/playwright test tests/qa-fragment-wallet.spec.ts --reporter=line
```

**Already run — the QA wallet below is fragmented and ready.** ~48 TKAS was enough.

Two corrections to what this document said before the tooling was actually run against
a node, both found the hard way:

1. **The script did not work as first written**, on two counts. The WASM `RpcClient`
   rejects Node 20's native `WebSocket` (`w3c websocket is not available`) and needs
   `globalThis.WebSocket` set from `ws`, already present transitively. And splitting one
   UTXO into 95 in a single transaction is refused with `Storage mass exceeds maximum`.
2. **KIP-9 storage mass caps the pieces one transaction can create**, at roughly
   `sqrt(balance / 1e7)` — measured against the shipped WASM: 47.9 TKAS tops out near
   **25 pieces**, whatever the input count, and reaching 95 in one transaction would
   need ~**900 TKAS**. What is cheap is splitting each UTXO on its own: those
   transactions are independent, so the script now submits one per UTXO per round and
   goes 37 → 95 in a single round. Small balances are fine; the earlier "one command,
   one transaction" framing was not.

Note the asymmetry: _creating_ many small UTXOs is mass-expensive, _spending_ them is
not. 48 TKAS was never a problem for the send being tested — only for manufacturing the
wallet that tests it.

### Step 1 — the reported scenario — **PASSED on testnet-10**

Sent 45 TKAS from the 95-UTXO wallet through the QA build.

|             | before                   | after                  |
| ----------- | ------------------------ | ---------------------- |
| source      | 47.834334 TKAS, 95 UTXOs | 2.725582 TKAS, 3 UTXOs |
| destination | **0 TKAS**, 0 UTXOs      | **45 TKAS**, 1 UTXO    |

Read back from `getUtxosByAddresses` after the fact, not from the extension's success
screen. The destination holds a single 45 TKAS output from `f1c3ddd2c1351f07…` — the
batch's **last** transaction; the source's change came out of that same transaction at
index 1. 93 of the 95 inputs were consumed, total fee 0.108752 TKAS.

On `main` this same send broadcasts `transactions[0]` — a compound transfer to the
sender's own change address — and the destination stays at 0 while a real fee is paid.

### Step 2 — regression, ordinary wallet — ready, not yet run

The source wallet is now down to **3 UTXOs**, which is exactly the unfragmented case.
Sending 1–2.5 TKAS from it pre-flights as **1 transaction** (`txs=1`, fee 0.0031–0.0043
TKAS), so the expected result is one transaction, no progress counter, unchanged
behaviour. Two minutes.

### Step 3 — Ledger, only if a device is to hand

Repeat step 1 with a device attached. Expect **one approval per transaction**. The
compound approvals show a transfer to the user's own change address for an amount they
did not type — judge whether that needs device-facing copy. If it is too confusing,
file it separately rather than blocking this fix; today those users' payments silently
do not happen at all.

### Answered offline — no longer on the manual list

- **Original item 4, "send the literal exact total balance."** Answered by probing
  `createTransactions` directly with the same numbers the UI would produce. The Max
  button's amount (`balance - 0.3 KAS`) delivers in full from a fragmented wallet — now
  a test in `kas-send-batch-unit.spec.ts`. A send of the _literal_ full balance throws
  `Insufficient funds` at every UTXO count including 1, on `main` too: there is nothing
  left to pay the fee, so the throw is correct and unrelated to this change.
  I had predicted this item was the likely breakage. It is not — that call was wrong.
- **"Does the fix change unfragmented behaviour?"** Covered by the unit test asserting
  a single-UTXO wallet still produces exactly one transaction.

---

## QA build reminder

> Load `~/Desktop/kastle-qa-b2/` in a **separate Chrome profile**. Two Kastle builds in
> one profile race to inject `window.kastle` and the results are not trustworthy.

---

## Human gates respected

No push, no PR, no tag, no merge, no release. The branch and both `.md` deliverables
exist locally in `~/Repositories/b2` on `fix/kas-send-multi-transaction`.
