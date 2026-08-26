# KAS-002 B2 + C + D — Ledger derivation unification and numeric marshalling

Branch `fix/ledger-derivation-unification`, base `main` @ `b5521ef` (release 2.59.4,
includes #306, #308, #310).

Three commits, all in `lib/wallet/account/ledger-account.ts` plus its tests:

|           |                                                                                            |
| --------- | ------------------------------------------------------------------------------------------ |
| `8f87bb6` | `fix(ledger): derive the device signing path from the same source as the address` (B2 + C) |
| `b36f0ec` | `fix(ledger): refuse unrepresentable amounts and missing UTXOs instead of sending NaN` (D) |
| `bc1e43d` | `fix(ledger): pin the emitted derivation fields for both Ledger account classes` (tests)   |

---

## Phase 0 — how the device turns the wire fields into a path

`hw-app-kaspa` does **not** build a BIP-32 path. It serializes `account` as a raw
big-endian `uint32` (`node_modules/hw-app-kaspa/src/transaction.ts:66-67`, validated to
`[0x80000000, 0xFFFFFFFF]` at `:41-43`) and `addressType` / `addressIndex` as a `uint8`
and a big-endian `uint32` **per input** (`:126-130`). The path is assembled in the
device firmware.

Confirmed from firmware source, `coderofstuff/app-kaspa` (EXTRACTED, not inferred):

`src/crypto.c:63-73` — the signing path, rebuilt **for each input**:

```c
transaction_input_t *txin =
    &G_context.tx_info.transaction.tx_inputs[G_context.tx_info.signing_input_index];

// 44'/111111'/account'/ address_type / address_index
G_context.bip32_path[0] = 0x8000002C;                              // 44'
G_context.bip32_path[1] = 0x8001b207;                              // 111111'
G_context.bip32_path[2] = G_context.tx_info.transaction.account;   // sent pre-hardened
G_context.bip32_path[3] = (uint32_t) (txin->address_type);
G_context.bip32_path[4] = txin->address_index;
G_context.bip32_path_len = 5;
```

`src/transaction/deserialize.c:198-199` and `src/transaction/tx_validate.c:58-64` — the
change output is validated against the same `tx->account` with
`bip32_path[3] = change_address_type`, `bip32_path[4] = change_address_index`.

So:

```text
path = m / 44' / 111111' / <account, already hardened> / <addressType> / <addressIndex>
```

`account` is hardened by the caller (hence `+ 0x80000000`); `addressType` and
`addressIndex` are not hardened. **The derivation is per input, not per transaction** —
which is what makes defect C real rather than cosmetic.

### Before-state truth table (main @ `b5521ef`)

Address path is what `getPublicKey` / `getPublicKeys` derive from
(`ledger-account.ts:36,45` read `this.path`); device path is what `signTx` emits.

| class                 | idx | address path           | source | device path            | source                  | match |
| --------------------- | --- | ---------------------- | ------ | ---------------------- | ----------------------- | ----- |
| `LegacyLedgerAccount` | 0   | `m/44'/111111'/0'/0/0` | `:28`  | `m/44'/111111'/0'/0/0` | `:90,68,69`             | ✅    |
| `LegacyLedgerAccount` | 3   | `m/44'/111111'/3'/0/0` | `:28`  | `m/44'/111111'/3'/0/0` | `:90,68,69`             | ✅    |
| `LedgerAccount`       | 0   | `m/44'/111111'/0'/0/0` | `:146` | `m/44'/111111'/0'/0/0` | `:90,68,69` (inherited) | ✅    |
| `LedgerAccount`       | 3   | `m/44'/111111'/0'/0/3` | `:146` | `m/44'/111111'/3'/0/0` | `:90,68,69` (inherited) | ❌    |

`LedgerAccount` overrode only `this.path` (`:146`) and inherited `signTx` unchanged, so
the index stayed in the hardened account position on the wire. The two agree only at
index 0. At index ≥ 1 the device signs with a key the UTXOs are not locked to, the
signature fails script verification, and the network rejects the transaction — **those
accounts' funds are unspendable today**.

`LedgerAccount`'s address path matches `HotWalletAccount`'s non-legacy scheme
(`lib/wallet/account/hot-wallet-account.ts:79,88` — `m/44'/111111'/0'/0/{i}`), which
confirms the address side is the correct one and the device side is the broken one.

### After-state truth table (this branch)

Only the two `LedgerAccount` device-path cells move. Every address path is byte-identical.

| class                 | idx | address path           | device path            | match | changed?             |
| --------------------- | --- | ---------------------- | ---------------------- | ----- | -------------------- |
| `LegacyLedgerAccount` | 0   | `m/44'/111111'/0'/0/0` | `m/44'/111111'/0'/0/0` | ✅    | no                   |
| `LegacyLedgerAccount` | 3   | `m/44'/111111'/3'/0/0` | `m/44'/111111'/3'/0/0` | ✅    | no                   |
| `LedgerAccount`       | 0   | `m/44'/111111'/0'/0/0` | `m/44'/111111'/0'/0/0` | ✅    | no                   |
| `LedgerAccount`       | 3   | `m/44'/111111'/0'/0/3` | `m/44'/111111'/0'/0/3` | ✅    | **device path only** |

Direction taken: **the device was moved onto the address path.** No address that
`getPublicKey`/`getPublicKeys` returns changes for any `(class, index)` pair. The
forbidden direction — changing `LedgerAccount.path` so addresses match the old device
behaviour — was not taken; it would have moved every existing non-legacy account's
address.

---

## What changed, and why this shape

### S1 (B2 + C) — one accessor, two consumers

The bug class here is _an inherited method that is wrong for the subclass_. Nothing in
`LedgerAccount`'s own source was incorrect, which is exactly why the F7-style
source-regex test could not have caught it. A fix that overrode `signTx` in
`LedgerAccount` would have removed this instance of the bug while leaving the shape that
produced it, so the unification the L2a review preferred was taken instead:

```ts
type LedgerDerivation = {
  account: number;      // unhardened; hardened at the hw-app-kaspa boundary
  addressType: 0 | 1;
  addressIndex: number;
};

// LegacyLedgerAccount — :81
protected getDerivationFields(): LedgerDerivation {
  return { account: this.accountIndex, addressType: 0, addressIndex: 0 };
}

// :86 — the address path is now computed, not stored
protected get path(): string {
  const { account, addressType, addressIndex } = this.getDerivationFields();
  return `m/44'/111111'/${account}'/${addressType}/${addressIndex}`;
}

// LedgerAccount — :216
protected override getDerivationFields(): LedgerDerivation {
  return { account: 0, addressType: 0, addressIndex: this.accountIndex };
}
```

`path` was a mutable `protected` field; it is now a getter with no setter, so the
subclass **cannot** override the address path without going through
`getDerivationFields()`. The desync is not fixed so much as made unrepresentable.
`LedgerAccount`'s constructor is gone — it has nothing left to do.

Three call sites read the accessor: `signTx`'s per-input fields and `account`
(`:120`), the change fields (`:158-159`), and `signMessage` (`:169`).

Defect C: the derivation now goes on **every** input rather than a hardcoded `0/0`
(`:126-141`). Kastle is single-address-per-account today, so per-input and per-account
values coincide — the point is that this is now a consequence of the accessor instead of
a coincidence that happens to hold. The firmware genuinely reads `address_type` /
`address_index` off each input (`crypto.c:70-71`), so this is the field the device uses,
not decoration.

`signMessage` was in the same failure mode: it passed `(message, 0, 0, accountIndex +
OFFSET)`, so a message signed by a non-legacy account at index ≥ 1 was signed with a key
that does not correspond to the address it is displayed under. It now reads the same
accessor. `LegacyLedgerAccount`'s emitted values are unchanged (`0, 0, i + OFFSET`);
this is asserted in the suite.

### S2 (D) — numeric marshalling

`hw-app-kaspa` genuinely requires `number`: `TransactionInput.value` and
`TransactionOutput.value` are typed `number` (`transaction.ts:107,178`) and serialized by
`toBigEndianHex`, which calls `.toString(16)` on the value (`:210-216`). There is no
BigInt API to reach for, so the fix is an explicit boundary rather than an invented one:

```ts
const MAX_LEDGER_SOMPI = BigInt(Number.MAX_SAFE_INTEGER);

function toLedgerSompi(value: bigint | undefined, what: string): number {
  if (value === undefined || value === null) {
    throw new Error(`Cannot sign on Ledger: ${what} has no amount.`);
  }
  if (value < 0n || value > MAX_LEDGER_SOMPI) {
    throw new Error(`Cannot sign on Ledger: ${what} is ${value} sompi, which is outside
      the range the Ledger app can be given exactly (0 to ${MAX_LEDGER_SOMPI} sompi).`);
  }
  return Number(value);
}
```

Above 2^53−1 sompi (~90.07M KAS) `Number()` silently rounds, so the device would display
and commit to an amount that is not the one being spent. Refusing is the only safe
option available; truncating is not.

The missing-UTXO case now throws before any device interaction (`:127-131`) instead of
producing `Number(undefined)` → `NaN` and `prevTxId: ""`. On main, an input with no UTXO
entry serialized into a structurally valid but wrong transaction: `toBigEndianHex(NaN)`
yields garbage and `Buffer.from("", "hex")` yields a zero-length outpoint. `outpointIndex`
and `prevTxId` are now read off the same checked `utxo` binding rather than three
independent optional chains.

### Out of scope, left intact

`hasUnsignableFields` and its call sites (#310), `toRpcTransaction`'s field zeroing
(A2/firmware), dApp sign-only `signTx` (needs A2), `lib/wallet/sign-script.ts`,
`lib/kaspa.ts`, `wasm/`, `package*.json`.

---

## Gauntlet receipts

| gate                                                            | result                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **G1** `npm run compile`                                        | 0 errors                                                                            |
| **G2** `npm run lint`                                           | `0 errors, 40 warnings in 34 files` — identical to the pre-edit baseline            |
| **G2** `npx prettier --check .`                                 | `All files formatted correctly`, exit 0                                             |
| **G3** `playwright test tests/signtx-unit.spec.ts`              | **40 passed** (25 pre-existing + 15 new), 824ms                                     |
| **G4** `git diff main...HEAD -- package.json package-lock.json` | empty                                                                               |
| **G5** legacy regression                                        | proven below                                                                        |
| **G6** address stability                                        | proven below                                                                        |
| **G7** #306/#308/#310                                           | intact, see below                                                                   |
| **G8** `npm run e2e`                                            | 40 passed; only the known pre-existing `onboarding.spec.ts:7` context timeout fails |

> Note on tooling: `npm run prettier` exits 2 under the local `rtk` shim even when
> prettier itself is clean. Verified directly — `npx prettier --check .` → exit 0.
> Same for `git diff | wc -c` reporting a stray trailing byte on an empty diff.

Files changed vs `main`: `lib/wallet/account/ledger-account.ts`,
`tests/signtx-unit.spec.ts`, `KAS002_BCD_SUMMARY.md`. Nothing else.

### G5 — legacy regression gate

Asserted as exact emitted values, not a code-read
(`tests/signtx-unit.spec.ts`, `ledger derivation unification (B2/C/D)`):

```ts
for (const index of [0, 1, 3]) {
  test(`legacy account ${index} signs from 44'/111111'/${index}'/0/0`, async () => {
    const tx = await signAndCapture(legacyAt(index));
    expect(tx.account).toBe(index + 0x80000000);
    expect(tx.changeAddressType).toBe(0);
    expect(tx.changeAddressIndex).toBe(0);
    expect(tx.inputs.map((i) => [i.addressType, i.addressIndex])).toEqual([
      [0, 0],
    ]);
  });
}
```

**Negative control** — the same tests run against `main`'s `ledger-account.ts` with the
branch's test file (`git show main:… > …`, run, restore):

| test                                                   | on `main` | on branch |
| ------------------------------------------------------ | --------- | --------- |
| `legacy account 0 signs from 44'/111111'/0'/0/0`       | PASS      | PASS      |
| `legacy account 1 signs from 44'/111111'/1'/0/0`       | PASS      | PASS      |
| `legacy account 3 signs from 44'/111111'/3'/0/0`       | PASS      | PASS      |
| `non-legacy account 0 signs from 44'/111111'/0'/0/0`   | PASS      | PASS      |
| `non-legacy account 1 signs from 44'/111111'/0'/0/1`   | **FAIL**  | PASS      |
| `non-legacy account 3 signs from 44'/111111'/0'/0/3`   | **FAIL**  | PASS      |
| every input carries the account's derivation           | **FAIL**  | PASS      |
| signMessage uses the same derivation                   | **FAIL**  | PASS      |
| refuses input amounts above the safe-integer boundary  | **FAIL**  | PASS      |
| refuses output amounts above the safe-integer boundary | **FAIL**  | PASS      |
| an amount at the safe-integer boundary still signs     | **FAIL**  | PASS      |
| refuses an input with no UTXO entry                    | **FAIL**  | PASS      |

Legacy passes on both sides at every index — bit-identical, and the assertions are live
so a future regression fails here. Non-legacy fails on `main` at index ≥ 1 only, which is
exactly the reported defect and exactly the cells the after-table moves.

The three `address path is unchanged…` tests also report FAIL against `main`, but that is
a harness artifact and **not** a behaviour difference: `main` assigns `this.path` in the
constructor, and the test harness builds instances off the prototype (`Object.create`) to
sidestep an unrelated ESM-interop failure — `hw-app-kaspa`'s default export is not
callable under the Playwright loader. On `main`'s shape the constructor never runs, so
`path` is `undefined`. G6 is therefore proven mechanically instead:

### G6 — address stability gate

Both `this.path` assignments were extracted from `main`'s source by regex and expanded,
then compared against the literals the branch's test pins:

```text
main LegacyLedgerAccount  this.path = m/44'/111111'/${accountIndex}'/0/0
main LedgerAccount        this.path = m/44'/111111'/0'/0/${accountIndex}

class                  idx  main                         branch                       match
LegacyLedgerAccount      0  m/44'/111111'/0'/0/0         m/44'/111111'/0'/0/0         YES
LegacyLedgerAccount      1  m/44'/111111'/1'/0/0         m/44'/111111'/1'/0/0         YES
LegacyLedgerAccount      3  m/44'/111111'/3'/0/0         m/44'/111111'/3'/0/0         YES
LedgerAccount            0  m/44'/111111'/0'/0/0         m/44'/111111'/0'/0/0         YES
LedgerAccount            1  m/44'/111111'/0'/0/1         m/44'/111111'/0'/0/1         YES
LedgerAccount            3  m/44'/111111'/0'/0/3         m/44'/111111'/0'/0/3         YES

G6 ADDRESS STABILITY: PASS - no address changes
```

`getPublicKey` / `getPublicKeys` derive solely from `this.path`
(`ledger-account.ts:95,104` — the only argument that varies), so identical paths mean
identical returned keys and identical addresses. The branch side of that table is also
pinned in the suite as hard literals, so any future edit that would move an existing
account's address fails a test rather than reaching a user.

### G7 — #306 / #308 / #310 intact

`git diff main...HEAD` touches no file any of them landed in. `lib/kaspa.ts` has a
0-byte diff.

| guard                                                      | present                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `assertSafeOutputSighash`                                  | `lib/wallet/sign-script.ts:35`                                                           |
| `ALLOW_UNSAFE_OUTPUT_SIGHASH`                              | `lib/wallet/sign-script.ts:26`                                                           |
| `toSignType` `hasOwnProperty` guard                        | `lib/kaspa.ts:68` (0-byte diff)                                                          |
| `PARTIAL_OUTPUT_WARNING`                                   | `SignTx.tsx:14`, imported by both confirm screens (`SignTx.tsx`, `SignAndBroadcast.tsx`) |
| `hasScriptOptions` gating `LedgerSignAndBroadcast`         | `LedgerSignAndBroadcast.tsx`                                                             |
| `hasUnsignableFields` + `LEDGER_UNSIGNABLE_FIELDS_MESSAGE` | `lib/wallet/sign-script.ts:104`, `LedgerSignAndBroadcast.tsx:24,48`                      |
| `LedgerSignTx` sign-only refusal                           | `SignTx.tsx`                                                                             |

Their unit tests — the U1, L1, F7 and A1 blocks — are among the 25 pre-existing tests
still passing in G3.

### G8 — e2e

`npm run e2e -- --reporter=line` → **1 failed, 40 passed (1.0m)**.

The single failure is the known pre-existing one, unchanged:

```text
1) [chromium] › tests/onboarding.spec.ts:7:1 › can reach password setup
   Test timeout of 30000ms exceeded while setting up "context".
   Worker teardown timeout of 30000ms exceeded.
```

No new failures. Every Ledger-related spec passes.

---

## Device QA — run 2026-08-26, all 9 items pass

Ledger Nano, testnet-10, build `2.59.4-qa-b2-ledger-derivation`, loaded with every other
Kastle disabled. Harness: `qa/index.html` (untracked), served over http.

**Build identification.** Both builds report `2.59.4`, so the version string cannot tell
them apart. #308 reworded one refusal into two, so a script-free sign-only `signTx` names
the build for free, without the device: post-fix answers `cannot complete sign-only
requests`, pre-fix answers `advanced scripts signing` / `Method not implemented.`. The
first QA run of this branch produced four results that all turned out to be a stale
pre-#308 build answering; the harness now gates on this fingerprint.

| #   | Item                                          | Result                                                                             |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Legacy 0 — Send broadcasts                    | ✅ `2cb3895923096337c52cae71937f0e89f10a6b85851fae3e68ae0cb20701ae5d`              |
| 2   | Legacy ≥1 — Send broadcasts                   | ✅ `c6e1ef27f39e94ced3b51890935ba6281abaad11cbfebc79b8b94cfd7b563773`              |
| 3   | Non-legacy 0 — Send broadcasts                | ✅ `46e45a1f957ba52525a27756bbc84a9c5d6b8bf21e09eaceef56597b6bc90ef7`              |
| 4   | **Non-legacy ≥1 — Send broadcasts (THE FIX)** | ✅ `69a4f07baf05d199e9cd77da227a056ef2959746ae0d0d54e23bc8dbf1aa3d6c`              |
| 5   | Addresses unchanged from the previous build   | ✅ 4/4 identical, legacy and non-legacy both                                       |
| 6   | dApp `signAndBroadcastTx`, default fields     | ✅ same broadcast as item 4                                                        |
| 7   | dApp `lockTime` / `payload` refused upfront   | ✅ both, exact A1 wording, no device prompt                                        |
| 8   | Hot wallet unaffected                         | ✅ `6fc3786bc7b3413dafdf447fce86912d032422cf6aabc31ce5b8f247eb645da1`              |
| 9   | Non-legacy ≥1 `signMessage` verifies          | ✅ `verifyMessage` true, and the signing key re-derives that account's own address |

Item 5 was checked on the x-only public key, not the address string: bech32 checksums
over the network prefix, so one account renders differently on mainnet and testnet and a
network switch looks like a moved address when it is not.

Legacy 0 and non-legacy 0 are the same path by construction
(`m/44'/111111'/0'/0/0`), so items 1 and 3 bind to one key wearing two labels. Both were
spent separately anyway.

### Found while testing, not part of B2/C/D

After `switchNetwork`, `getAccount()` kept returning the previous network's address:
`ApiUtils.getCurrentAccount()` reads the stored `account.address`, which is only
re-derived (`useAccountManager.ts:152`) while the popup is mounted. Opening the popup
heals it. Pre-existing, unrelated to this branch — needs its own ticket.

---

## Human-only, not done here

Push, PR, merge, tag, release-please, store submission, loading the unpacked extension.
