# W1 — WASM secret objects never freed: Phase 1 investigation

Read-only. Base `main` @ `a441e75`. Node 20.20.2. All claims below were verified by
opening `wasm/core/kaspa.js` / `kaspa.d.ts` and the call sites — no INFERRED graph edge
is load-bearing.

**Headline correction to the brief's premise.** The brief states "wasm-bindgen objects
are not reclaimed by JS GC. Every allocation persists in WASM linear memory for the life
of that instance." **That is false for this build.** Every secret-bearing class registers
with a `FinalizationRegistry`, on both allocation paths. These objects _are_ reclaimed —
just nondeterministically and late. The defect is real but it is **delayed reclamation**,
not an unbounded leak. Section P1.1 has the receipts; P1.4 re-grades severity accordingly.

---

## P1.1 — Does `.free()` exist, and is there already GC-driven cleanup?

Yes to both, for all four secret-bearing classes.

| Class        | `free()` | FinalizationRegistry     | Registry decl    |
| ------------ | -------- | ------------------------ | ---------------- |
| `PrivateKey` | yes      | `PrivateKeyFinalization` | `kaspa.js:6948`  |
| `Keypair`    | yes      | `KeypairFinalization`    | `kaspa.js:4675`  |
| `XPrv`       | yes      | `XPrvFinalization`       | `kaspa.js:13498` |
| `Mnemonic`   | yes      | `MnemonicFinalization`   | `kaspa.js:4918`  |

```js
// wasm/core/kaspa.js:6948
const PrivateKeyFinalization =
  typeof FinalizationRegistry === "undefined"
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_privatekey_free(ptr >>> 0, 1),
      );
```

**Both** allocation paths register:

- `static __wrap(ptr)` — used by every method that returns a new object
  (`kaspa.js:6961`: `PrivateKeyFinalization.register(obj, obj.__wbg_ptr, obj)`)
- `constructor(key)` — `kaspa.js:7098`: `PrivateKeyFinalization.register(this, this.__wbg_ptr, this)`

So nothing is permanently stranded. `free()` is a _deterministic, prompt_ deallocation
in place of a nondeterministic, late one.

**Why that still matters.** The JS GC sees only the ~50-byte wrapper object; the WASM-side
allocation is invisible to its heap accounting and exerts zero collection pressure. This is
the standard wasm-bindgen visibility gap: the registry fires eventually, on the GC's
schedule, driven by JS-heap pressure that these objects barely contribute to. In a popup
that allocates one `Mnemonic` per keystroke (P1.3, site 14), "eventually" is unbounded in
practice. That is the honest case for `.free()` — not "GC never runs", but "GC has no
visibility into the cost, so it runs far too late."

**Ownership semantics (this gates whether freeing is even safe).** Verified by scanning
each class body and the free functions for `_assertClass` (borrow-check) vs
`__destroy_into_raw` (ownership transfer):

| Callee                                   | Takes `PrivateKey` by               | Safe to `free()` after? |
| ---------------------------------------- | ----------------------------------- | ----------------------- |
| `createInputSignature` (`kaspa.js:1122`) | borrow (`_assertClass`, no destroy) | **yes**                 |
| `signTransaction` (`kaspa.js:1063`)      | borrow                              | **yes**                 |
| `signScriptHash` (`kaspa.js:1087`)       | borrow                              | **yes**                 |
| `signMessage` (`kaspa.js:1231`)          | takes a **string**, not an object   | n/a                     |

No method on any of the four classes consumes `this`. The caller always retains ownership
and is always responsible for freeing.

**Derived objects are independent allocations, not views** — the critical safety
precondition for freeing a parent after deriving from it:

| Method                             | Returns                                     |
| ---------------------------------- | ------------------------------------------- |
| `XPrv.derivePath` (`:13553`)       | `XPrv.__wrap(...)` — fresh allocation       |
| `XPrv.deriveChild` (`:13611`)      | `XPrv.__wrap(...)` — fresh allocation       |
| `XPrv.toPrivateKey` (`:13651`)     | `PrivateKey.__wrap(...)` — fresh allocation |
| `PrivateKey.toKeypair` (`:7004`)   | `Keypair.__wrap(...)` — fresh allocation    |
| `PrivateKey.toPublicKey` (`:7022`) | `PublicKey.__wrap(...)` — fresh allocation  |
| `Mnemonic.toSeed` (`:4985`)        | **JS string** (`getStringFromWasm0`)        |
| `Mnemonic.phrase` (`:5033`)        | **JS string**                               |
| `Keypair.privateKey` (`:4763`)     | **JS string**                               |
| `XPrv.privateKey` (`:13688`)       | **JS string**                               |

Freeing an `XPrv` after `derivePath()` does not invalidate the child. Confirmed in source.

---

## P1.2 — Does the Rust side zeroize on drop?

**`BLOCKED: needs upstream confirmation.`** Strong negative signal, not proof.

The Rust source is not in the repo. The compiled binary is not vendored under `wasm/`
either (only `kaspa.js`, `kaspa.d.ts`, `kaspa_bg.wasm.d.ts`); the binary is emitted at
build time. Probing a built artifact (`.output/chrome-mv3/assets/kaspa_bg-*.wasm`,
11.8 MB):

| Symbol      | Occurrences |
| ----------- | ----------- |
| `zeroize`   | **0**       |
| `Zeroizing` | **0**       |
| `secp256k1` | 33          |
| `bip32`     | 49          |
| `panicked`  | 5           |
| `unwrap`    | 92          |

The string table is clearly **not stripped** — crate and module names survive — so the
absence of `zeroize` carries weight. It is not conclusive: the `zeroize` crate's `Drop`
impls are thin `write_volatile` loops that may be fully inlined and emit no string
literals at all. Absence of the string is evidence of absence of the _dependency_, not
proof of absence of the _behavior_.

**What would settle it:** the `Cargo.toml` / `Cargo.lock` of the `kaspa-wasm` crate that
produced this binary — is `zeroize` in the dependency tree, and do `PrivateKey` / `Keypair`
/ `XPrv` / `Mnemonic` derive `ZeroizeOnDrop`? That is the question to raise upstream with
`@kcoin/kaspa-web3.js`.

**Consequence for Phase 2:** this is a **leak/promptness fix with only partial security
benefit**. `free()` returns the allocation to the WASM allocator with its bytes intact;
the secret remains readable in linear memory until something else happens to reuse that
region. Do not describe this work as wiping keys from memory.

---

## P1.3 — Complete allocation-site inventory

19 sites across 7 files. `.free()` appears **zero** times in `lib/`, `hooks/`, `api/`,
`components/`, `entrypoints/` — confirmed, the brief is correct on this point.

### Bucket A — local scope, safe to free in `finally`

| #   | Site                                           | Class(es) allocated                                   | Notes                                                                                                                                                                                                                     |
| --- | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lib/wallet/sign-script.ts:204`                | `PrivateKey`                                          | **Highest value.** Inline temp inside `signTxInputWithScriptOption`, called once **per input** from the loop at `:246-248`. An N-input tx allocates N. Callee borrows (P1.1) → free after `createInputSignature` returns. |
| 2   | `hot-wallet-account.ts:15-16`                  | `Keypair` (+ `PrivateKey` from site 12)               | `getPrivateKeyString()`. Returns a string; both objects dead at return.                                                                                                                                                   |
| 3   | `hot-wallet-account.ts:20`                     | `XPrv`                                                | `LegacyHotWalletAccount.getPublicKeys()` seed root; dead at `:32`.                                                                                                                                                        |
| 4   | `hot-wallet-account.ts:25-27`                  | `XPrv` (derivePath temp) + `PrivateKey`               | **In a 50-iteration loop** (`MAX_DERIVATION_INDEXES = 50`).                                                                                                                                                               |
| 5   | `hot-wallet-account.ts:29`                     | `PublicKey`                                           | Same loop. Not secret-bearing, but same leak; sites 3-5 total **150 objects per call**.                                                                                                                                   |
| 6   | `hot-wallet-account.ts:41`                     | `PrivateKey` (temp)                                   | `getPublicKey()`. The returned `PublicKey` is bucket B — free only the `PrivateKey`.                                                                                                                                      |
| 7   | `hot-wallet-account.ts:56`                     | `XPrv`                                                | `LegacyHotWalletAccount.getPrivateKeys()` root.                                                                                                                                                                           |
| 8   | `hot-wallet-account.ts:60-64`                  | `XPrv` temp + `PrivateKey` + `Keypair`                | Loop over `indexes`; returns `string[]`, no WASM escapes.                                                                                                                                                                 |
| 9   | `hot-wallet-account.ts:77-82`                  | `XPrv` + derivePath temp + `PrivateKey` + `PublicKey` | `HotWalletAccount.getPublicKeys()`.                                                                                                                                                                                       |
| 10  | `hot-wallet-account.ts:93`                     | `PrivateKey` (temp) + `Keypair`                       | `HotWalletAccount.getPrivateKeys()`; returns `string[]`.                                                                                                                                                                  |
| 11  | `hot-wallet-account.ts:49-51`, `86-88`         | `XPrv` + derivePath temp                              | Roots inside `getPrivateKey()`. The **returned** `PrivateKey` is bucket B; the `XPrv` and the intermediate are local and freeable here.                                                                                   |
| 12  | `account-factory.ts:16`, `:42`                 | `Mnemonic`                                            | `Mnemonic.random(12).phrase` → string. Both `LegacyAccountFactory` and `AccountFactory`.                                                                                                                                  |
| 13  | `account-factory.ts:28`, `:54`                 | `Mnemonic`                                            | `new Mnemonic(m).toSeed(p)` → string. Both branches.                                                                                                                                                                      |
| 14  | `ImportRecoveryPhrase.tsx:110`                 | `Mnemonic`                                            | Validation-only, discarded. In a `useEffect` keyed `[inputWords]` → **one allocation per keystroke**, in the long-lived popup instance.                                                                                   |
| 15  | `ImportPrivateKey.tsx:99`                      | `PrivateKey`                                          | Validation-only inside react-hook-form `validate`; result discarded. Fires per validation pass.                                                                                                                           |
| 16  | `ImportRecoveryPhraseWithPassphrase.tsx:33`    | `Mnemonic`                                            | Validation-only, discarded.                                                                                                                                                                                               |
| 17  | `lib/ethereum/wallet/account-factory.ts:12-18` | `Mnemonic` + `XPrv` + derivePath temp + `PrivateKey`  | `LegacyAccountFactory.createFromMnemonic`. Secret leaves as `privateKey.toString()` at `:20`.                                                                                                                             |
| 18  | `lib/ethereum/wallet/account-factory.ts:35-41` | same four                                             | `AccountFactory.createFromMnemonic`.                                                                                                                                                                                      |

Sites 17/18 each contain the `isLegacy` ternary internally (`:14-16`, `:37-39`) — the
allocation shape is **identical on both branches**, so a single fix per method covers both.

### Bucket B — returned to caller; do NOT free at the allocation site

| Site                                                                   | Class        | Consumers                                                                                                      | Last use                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hot-wallet-account.ts:50-52` (`LegacyHotWalletAccount.getPrivateKey`) | `PrivateKey` | `:15` (`getPrivateKeyString`), `:41` (`getPublicKey`), `:93` (subclass `getPrivateKeys`)                       | All three consumers are **inside this class file** (`protected`, no external callers — verified by grep across `lib/ hooks/ api/ components/ entrypoints/`). |
| `hot-wallet-account.ts:87-89` (`HotWalletAccount.getPrivateKey`)       | `PrivateKey` | same three                                                                                                     | same                                                                                                                                                         |
| `hot-wallet-account.ts:41` (`getPublicKey` return)                     | `PublicKey`  | 12 call sites across `lib/krc20.ts`, `lib/kns.ts`, `lib/krc721.ts`, `lib/commit-reveal.ts`, `hooks/`, handlers | Not secret-bearing. Lifetime is caller-controlled and diffuse. Leave.                                                                                        |

Because every consumer of the returned `PrivateKey` is local to the class, bucket B is
**fully covered indirectly**: each consumer (sites 2, 6, 10) frees it as its own local.
The allocation site itself stays untouched.

### Bucket C — stored on an instance

| Site                           | Class        | Lifecycle                                                                              |
| ------------------------------ | ------------ | -------------------------------------------------------------------------------------- |
| `hot-wallet-private-key.ts:15` | `PrivateKey` | ctor param retained as `private privateKey`; read by `getPublicKey()` `:24`.           |
| `hot-wallet-private-key.ts:16` | `Keypair`    | `this.keypair`; read by `:20`, `:28`.                                                  |
| `account-factory.ts:34`, `:60` | `PrivateKey` | `new HotWalletPrivateKey(new PrivateKey(...))` — handed straight into the field above. |

**`IWallet` (`wallet-interface.ts:23-31`) declares no teardown method**, and no call site
disposes a wallet. Adding one means changing the interface, all six implementations, and
every construction site — well outside "call-site changes only", and with no unambiguous
call point it would be dead code. **Treated as D. Not touched in Phase 2.**

### Bucket D — ambiguous, leave alone

The three bucket-C sites above, plus the `PublicKey` returned from `getPublicKey()`.
No site required a coin-flip: every A-classification rests on a return type of `string`
or a value dead before the function returns.

### The bigger exposure that `.free()` does not touch

`Mnemonic.toSeed()`, `Keypair.privateKey`, `XPrv.privateKey` and `PrivateKey.toString()`
all return **plain JS strings** (P1.1 table). Consequently:

- `LegacyHotWalletAccount` holds `protected readonly seed: string` — the **master seed**,
  in the JS heap, for the account object's entire life (`hot-wallet-account.ts:10`).
- `getPrivateKeyString()` hands a hex private key to `signTxWithScriptOptions` and
  `signMessage` as a string (`:37`, `:45`).
- `EthereumPrivateKeyAccount` receives `privateKey.toString()` (`eth account-factory.ts:20`, `:42`).

JS strings are immutable and cannot be zeroed. **This is the dominant secret-in-memory
surface in the codebase, and it is strictly larger than the WASM one.** Phase 2 does not
address it and must not claim to.

---

## P1.4 — Exposure assessment

Grading the two instances separately.

**Background service worker.** Secrets are decrypted only for the duration of a signing
operation and discarded after (handover §4.5); `lock()` nulls `masterKey`; Chrome reclaims
an idle MV3 SW after ~30s, taking the entire WASM instance — linear memory and all — with
it. Objects allocated during a sign are also `FinalizationRegistry`-eligible immediately
after. Realistic residency: **seconds to a few minutes**, hard-bounded by SW teardown.

**Popup.** Lives as long as the popup is open — typically seconds to minutes, but pinned
open indefinitely in a side panel. `ImportRecoveryPhrase.tsx:110` allocates a `Mnemonic`
per keystroke here, so a 24-word phrase entry leaves on the order of 100+ `Mnemonic`
objects, each holding the **full recovery phrase**, resident until GC decides otherwise.
That is the worst single case in the codebase — and it is exactly the moment the user's
most sensitive secret is in play.

**Verdict: Low-to-Medium, below the brief's implied Medium.** Reasons:

1. The `FinalizationRegistry` (P1.1) means this is delayed reclamation, not a permanent
   leak — the brief's premise 1 does not hold.
2. SW teardown hard-bounds the background instance independently of anything we do.
3. Reading WASM linear memory requires code execution in the extension's own origin.
   An attacker with that already has the decrypted `masterKey` and the JS-heap seed
   string — both easier targets than scavenging a WASM heap.
4. The JS-heap strings above are a strictly larger, strictly easier target that this work
   does not shrink at all.

The genuine, defensible wins from Phase 2 are (a) bounded WASM memory growth in the popup,
(b) a shorter and _deterministic_ residency window, (c) removing 150-object-per-call
churn from `getPublicKeys()`. Not "keys are wiped."

---

## P1.5 — Test strategy

The harness supports more than the brief assumed. `tests/signtx-unit.spec.ts` already
imports `init` from `@/wasm/core/kaspa` **and** real app modules (`sign-script`,
`ledger-account`, `kaspa-compat`), and runs node-side: **40 tests, 1.1s**. Importing
`AccountFactory` / `LegacyAccountFactory` there is a one-line addition.

Baseline captured before any edit (`w1`, node 20.20.2):

| Check                                           | Baseline         |
| ----------------------------------------------- | ---------------- |
| `npm run compile`                               | exit 0, 0 errors |
| `npm run lint`                                  | exit 0, clean    |
| `npm run prettier` (`--check .`)                | exit 0, clean    |
| `npx playwright test tests/signtx-unit.spec.ts` | **40 passed**    |

Proposed tests, all in `tests/signtx-unit.spec.ts`:

1. **Derivation parity, both `isLegacy` branches (G6, required).** Pin a fixed test
   mnemonic. Assert `LegacyAccountFactory().createFromMnemonic(m, i)` and
   `AccountFactory().createFromMnemonic(m, i)` produce the **exact expected address
   strings**, hardcoded from a pre-change run, for several `accountIndex` values. This is
   the wrong-key-signs guard: it fails if a `free()` corrupts a derivation on either path,
   _and_ it fails if the two paths are ever swapped. Hardcoding the expected values (rather
   than comparing branch-to-branch) is what makes it a real regression fence.
2. **Signing still succeeds after free-bearing code paths run.** Drive
   `signTxWithScriptOptions` over a multi-input tx so `sign-script.ts:204` allocates and
   frees per input; assert every input gets a `signatureScript` and that the signatures
   verify against the schnorr path the file already uses (`@noble/curves`).
3. **Repeat-call stability.** Call `getPublicKeys()` and `signTx` in a loop (~20×) on both
   account classes. A misplaced free surfaces as `null pointer passed to rust` on
   iteration 2 — this is the cheapest possible detector for use-after-free, and it costs
   milliseconds node-side.
4. **Free actually happened.** Allocate a `PrivateKey`, `free()` it, assert a subsequent
   `.toString()` throws. Proves the deallocation is real rather than a silent no-op, and
   documents the observable semantics the other tests rely on.
5. **`signMessage` on both branches.** Assert a stable signature for a fixed message/key
   on `HotWalletAccount` and `LegacyHotWalletAccount`.

Not proposable: any assertion about _linear memory shrinking_. `WebAssembly.Memory` never
returns pages to the OS, and there is no exposed allocator introspection. The absence of
this test should be stated in the summary rather than papered over.

---

## GATE

| Criterion                                              | Status                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `.free()` confirmed available                          | **PASS** — all four classes, `kaspa.js` decls quoted in P1.1                         |
| Bucket (A) non-trivial                                 | **PASS** — 18 sites across 7 files, incl. a per-input allocation on the signing path |
| Test proving signing works on both `isLegacy` branches | **PASS** — harness runs node-side with real app modules; test 1 + test 2 above       |
| Freeing is provably safe                               | **PASS** — all callees borrow; all derived objects are independent allocations       |

**PROCEED to Phase 2**, with scope explicitly bounded to bucket A, and with the severity
claim corrected: this is a promptness/bounded-growth fix, not a leak elimination and not
a memory-wiping fix.

**Follow-ups, not this branch:** upstream `ZeroizeOnDrop` question to
`@kcoin/kaspa-web3.js` (P1.2); the JS-heap seed/private-key strings (P1.3 last section),
which are the larger problem; `IWallet` teardown for `HotWalletPrivateKey` (bucket C).
