# W1 — WASM secret objects never freed or zeroized

**Branch:** `fix/wasm-secret-lifecycle` (5 commits, not pushed)
**Base:** `main` @ `a441e75`
**Status:** Phase 1 complete, gate cleared, Phase 2 complete, gauntlet green. Awaiting human review + device QA.
**Not done (human gates):** no push, no PR, no merge, no tag, no release.

---

## 0. TL;DR — and one correction to the brief

The brief's premise #1 is **false as stated**. It says these objects are "never freed". They are
freed — every secret-bearing class registers with a `FinalizationRegistry` on **both** allocation
paths (`__wrap` and the constructor). This is not an unbounded leak; it is **delayed, nondeterministic
reclamation**.

That does not make the work pointless, but it does change the justification. The real problem is a
**GC-visibility gap**: the JS heap object is a ~50-byte wrapper holding a pointer, while the
allocation it owns lives in WASM linear memory where the JS GC has no visibility and feels no
pressure. So the wrapper survives arbitrarily long, and with it the secret. `free()` at last use
makes reclamation deterministic and bounds linear-memory growth.

Severity is graded **Low-to-Medium**, below the brief's implied Medium. See §P1.4.

**What this branch does:** every secret-bearing WASM object allocated in a scope that owns it is now
freed at last use, on both `isLegacy` derivation branches, with 21 new tests pinning derived
addresses so a branch swap cannot pass silently.

**What this branch does NOT do:** it does not wipe key material from memory. See §7.

---

## 1. Phase 1 findings

### P1.1 — Does `.free()` exist? Is there a `FinalizationRegistry`?

Both yes. From `wasm/core/kaspa.js` (read-only, certified inventory):

```js
// :6948
const PrivateKeyFinalization =
  typeof FinalizationRegistry === "undefined"
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) =>
        wasm.__wbg_privatekey_free(ptr >>> 0, 1),
      );
```

| Class        | Finalization registry          | `free()` exposed |
| ------------ | ------------------------------ | ---------------- |
| `PrivateKey` | `PrivateKeyFinalization` :6948 | yes              |
| `Keypair`    | `KeypairFinalization` :4675    | yes              |
| `XPrv`       | `XPrvFinalization` :13498      | yes              |
| `Mnemonic`   | `MnemonicFinalization` :4918   | yes              |

Registration happens on **both** paths — `__wrap` at :6961 and the public constructor at :7098 — so
no allocation route escapes it. Nothing is stranded forever; it is reclaimed _late_.

**Ownership probe (this is what made freeing provably safe).** Before writing a single `.free()`, I
checked the generated glue for every function these objects are passed to, looking for
`_assertClass` (type-check = **borrow**) versus `__destroy_into_raw` (**consumes**):

| Callee                       | `_assertClass` | `__destroy_into_raw` | Semantics                       |
| ---------------------------- | -------------- | -------------------- | ------------------------------- |
| `createInputSignature` L1122 | yes            | no                   | borrows                         |
| `signTransaction` L1063      | yes            | no                   | borrows                         |
| `signScriptHash` L1087       | yes            | no                   | borrows                         |
| `signMessage` L1231          | —              | —                    | takes a `string`, not an object |

No method consumes `this`. Derived objects are **independent allocations** (`XPrv.derivePath` →
`XPrv.__wrap`, `toPrivateKey` → `PrivateKey.__wrap`, `toKeypair` → `Keypair.__wrap`, `toPublicKey`
→ `PublicKey.__wrap`), so freeing a parent after deriving from it is safe. This is the fact the
whole fix rests on; it was verified by reading the glue, not inferred.

### P1.2 — Does the Rust side zeroize on drop?

**No evidence of it, and the negative signal is strong.** Probing `assets/kaspa_bg.wasm`
(11,817,646 bytes — note: the binary is under `assets/`, _not_ `wasm/core/`, which holds only
`kaspa.d.ts` / `kaspa.js` / `kaspa_bg.wasm.d.ts`):

| Symbol      | Occurrences |
| ----------- | ----------- |
| `zeroize`   | **0**       |
| `Zeroizing` | **0**       |
| `secp256k1` | 33          |
| `bip32`     | 49          |
| `panicked`  | 5           |
| `unwrap`    | 92          |

The control symbols prove the binary retains crate/symbol strings, so `zeroize` being absent is
meaningful rather than an artifact of stripping. It is still not _proof_ — inlining and
monomorphization can erase a name.

**`BLOCKED: needs upstream confirmation`** from `@kcoin/kaspa-web3.js`. See §8.

### P1.3 — Allocation-site inventory

Buckets per the brief: **A** local scope (safe to free), **B** returned to caller (freeing at the
alloc site is use-after-free), **C** stored on an instance (needs explicit lifecycle), **D**
ambiguous (leave alone, list).

| Site                                                    | Object                                    | Bucket | Action                                           |
| ------------------------------------------------------- | ----------------------------------------- | ------ | ------------------------------------------------ |
| `lib/wallet/sign-script.ts:205`                         | `PrivateKey` (**per input**)              | A      | **fixed**                                        |
| `hot-wallet-account.ts` `getPrivateKeyString`           | `PrivateKey`, `Keypair`                   | A      | **fixed**                                        |
| `hot-wallet-account.ts` `getPublicKeys` (legacy)        | `XPrv` + 3×50 derived                     | A      | **fixed**, freed per iteration                   |
| `hot-wallet-account.ts` `getPublicKeys` (new)           | `XPrv`, `XPrv`, `PrivateKey`              | A      | **fixed**                                        |
| `hot-wallet-account.ts` `getPrivateKeys` (both)         | `XPrv` + per-index derived                | A      | **fixed**, freed per iteration                   |
| `hot-wallet-account.ts` `getPublicKey` (both)           | `PrivateKey` (intermediate)               | A      | **fixed** (returned `PublicKey` left to caller)  |
| `hot-wallet-account.ts` `getPrivateKey` (both)          | `XPrv`, intermediate `XPrv`               | A      | **fixed** (returned `PrivateKey` left to caller) |
| `lib/wallet/account-factory.ts` `generateMnemonic` ×2   | `Mnemonic`                                | A      | **fixed**                                        |
| `lib/wallet/account-factory.ts` `createFromMnemonic` ×2 | `Mnemonic`                                | A      | **fixed**                                        |
| `lib/ethereum/wallet/account-factory.ts` ×2             | `Mnemonic`, `XPrv`, derived, `PrivateKey` | A      | **fixed**, both `isLegacy` branches in one scope |
| `ImportPrivateKey.tsx:99`                               | `PrivateKey` (validation only)            | A      | **fixed**                                        |
| `ImportRecoveryPhrase.tsx:110`                          | `Mnemonic` (validation only)              | A      | **fixed**                                        |
| `ImportRecoveryPhraseWithPassphrase.tsx:33`             | `Mnemonic` (validation only)              | A      | **fixed**                                        |
| `hot-wallet-account.ts` `getPrivateKey` return value    | `PrivateKey`                              | **B**  | **not touched** — caller owns it                 |
| `hot-wallet-account.ts` `getPublicKey` return value     | `PublicKey`                               | **B**  | **not touched** — caller owns it                 |
| `account-factory.ts` `createFromPrivateKey` ×2          | `PrivateKey` → `HotWalletPrivateKey`      | **C**  | **not touched** — see below                      |
| `hot-wallet-private-key.ts:16`                          | `PrivateKey` held as a field              | **C**  | **not touched** — see below                      |

**Why bucket C was left alone.** `HotWalletPrivateKey` holds a `PrivateKey` for the object's entire
life and has no disposal hook, no `destroy()`, and no caller that knows when the account is done.
Freeing it needs a lifecycle contract that does not exist yet, and inventing one would mean touching
the wallet-teardown path — well outside "call-site changes only", and squarely in the 🔴 signing
blast radius. Listed, not guessed. This is the main follow-up.

The three validation-only import sites deserve a note: those effects re-run **on every keystroke**,
so they were allocating a fresh `Mnemonic`/`PrivateKey` per character typed. Small objects, but the
highest _allocation rate_ in the codebase.

### P1.4 — Exposure assessment: **Low-to-Medium**

Below the brief's implied Medium. Reasoning, stated so it can be argued with:

- **Down:** the `FinalizationRegistry` exists (§P1.1), so this is delayed reclamation, not
  permanent retention.
- **Down:** MV3 service-worker teardown hard-bounds the background instance's lifetime — the whole
  linear memory dies on reclaim, typically within ~30s idle.
- **Down:** exploiting this requires **code execution in the extension's own context**. An attacker
  who has that can read the decrypted mnemonic out of the wallet state directly and does not need to
  scrape linear memory.
- **Up:** WASM linear memory is a plain JS-readable `ArrayBuffer` — no privilege boundary at all.
- **Up, and larger than the WASM surface:** `toSeed()`, `Keypair.privateKey`, `XPrv.privateKey` and
  `PrivateKey.toString()` all return **plain immutable JS strings**. `LegacyHotWalletAccount` holds
  the master seed as `protected readonly seed: string` for its entire lifetime. Immutable strings
  cannot be zeroed at all, in any language runtime, ever.

**That last point matters more than everything this branch fixes.** The plaintext-string surface is
strictly larger and strictly harder to remediate than the WASM-object surface, and Phase 2 does not
address it. Anyone reading this summary as "the memory-exposure issue is handled" has misread it.

### P1.5 — Test strategy

Constraint discovered while writing tests: **Kaspa schnorr message signing uses aux randomness**, so
the same key produces a different signature every run. Signatures cannot be pinned as fixtures.
Tests therefore assert on **derived addresses and public keys** (deterministic) and check signatures
**structurally** (present, correct length, verifies).

Second constraint, and the one that actually guards the landmine: **at `accountIndex` 0 the two
derivation paths coincide.**

```
legacy: m/44'/111111'/{accountIndex}'/0/{index}
new:    m/44'/111111'/0'/0/{accountIndex}
```

At index 0 both reduce to `m/44'/111111'/0'/0/0`. A test that only covers index 0 will pass happily
through a branch swap. Vectors were therefore captured at **indexes 0, 1 and 3**, generated
programmatically from the unmodified code rather than transcribed by hand.

| Branch / index | Address (truncated)             |
| -------------- | ------------------------------- |
| legacy 0       | `kaspa:qqd6e65yefepe9wk0m9vux…` |
| new 0          | _identical_ — this is the trap  |
| legacy 1       | `kaspa:qzyqe0y64jqvx043jd0mpg…` |
| new 1          | `kaspa:qp6r0d88yj4fazlj057wc3…` |
| legacy 3       | `kaspa:qrgg2k6l7r96x8ckw64rnc…` |
| new 3          | `kaspa:qqwn552u0tdqgcggarzeh2…` |

Mnemonic: `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`.

---

## 2. GATE decision

| Gate condition                                             | Result                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `.free()` confirmed available                              | ✅ all four classes                                           |
| Bucket (A) non-trivial                                     | ✅ 13 sites, incl. a per-input allocation on the signing path |
| Test proving signing works on **both** `isLegacy` branches | ✅ 21 tests, vectors at indexes 0/1/3                         |

**Gate cleared → proceeded to Phase 2.**

---

## 3. What changed

```
06049de test: cover WASM secret lifecycle on both derivation branches
af88ded fix: free validation-only WASM secret objects in the import screens
4a6cabb fix: free Mnemonic and XPrv temporaries in the account factories
991ce2d fix: free WASM secret objects in hot wallet derivation
d5337e1 fix: free the per-input PrivateKey on the signing path
```

```
 components/screens/full-pages/ImportPrivateKey.tsx                  |   6 +-
 components/screens/full-pages/ImportRecoveryPhrase.tsx              |   6 +-
 components/screens/full-pages/ImportRecoveryPhraseWithPassphrase.tsx|   6 +-
 lib/ethereum/wallet/account-factory.ts                              |  36 ++--
 lib/wallet/account-factory.ts                                       |  15 +-
 lib/wallet/account/hot-wallet-account.ts                            | 117 +++++++-----
 lib/wallet/sign-script.ts                                           |  16 +-
 lib/wallet/wasm-lifecycle.ts                                        |  52 ++++++
 tests/signtx-unit.spec.ts                                           | 203 +++++++++++++++++++++
 9 files changed, 388 insertions(+), 69 deletions(-)
```

One new file, `lib/wallet/wasm-lifecycle.ts` (52 lines), exporting a single scope guard:

```ts
export function withOwned<T>(
  fn: (own: <O extends Freeable>(o: O) => O) => T,
): T;
```

Register at the point of creation — `own(new XPrv(seed))` — and everything registered is freed when
the scope returns _or throws_. Chosen over hand-written nested `try/finally` because the deepest site
nests three objects and hand-rolled unwinding at three levels is where use-after-free bugs come from.
It is **synchronous only** — with an async `fn` the `finally` would fire at the first `await` and
free objects still in use. Every current caller is sync; the doc comment says so.

Per the brief: **no `FinalizationRegistry` was added** (one already exists upstream anyway).

---

## 4. Gauntlet receipts

| #   | Check                                                    | Result                                                       |
| --- | -------------------------------------------------------- | ------------------------------------------------------------ |
| G1  | `npm run compile`                                        | ✅ exit 0, 0 errors                                          |
| G2  | lint / prettier                                          | ✅ eslint exit 0 · prettier exit 0                           |
| G3  | `playwright test tests/signtx-unit.spec.ts`              | ✅ **61 passed** (40 baseline + 21 new)                      |
| G4  | `git diff main...HEAD -- package.json package-lock.json` | ✅ **0 lines**                                               |
| G5  | `git diff main...HEAD -- wasm/ assets/`                  | ✅ **0 lines**                                               |
| G6  | ⚠️ both `isLegacy` branches unchanged                    | ✅ pinned vectors at indexes 0/1/3                           |
| G7  | shipped guards intact                                    | ✅ see below                                                 |
| G8  | `npm run e2e`                                            | ✅ 61 passed, 1 failure — **pre-existing, proven on `main`** |

**G2 note.** `npm run prettier` returns a bogus exit and the `rtk` shim prints a fabricated
"All files formatted correctly" banner regardless of the true result. Both tools were therefore run
via their **direct binary paths** (`./node_modules/.bin/…`) and the exit codes taken as
authoritative. Doing this caught a genuine prettier failure the fake banner had hidden — it was
`W1_INVESTIGATION.md`, an untracked deliverable, not a source file; formatted, now exit 0. eslint's
baseline `no-unused-vars` warnings across ~33 unrelated files are unchanged, and 0 hits land on any
file this branch touches.

**G7 — shipped guards, all verified present and unmodified:**

| PR   | Guard                                                                                   | Location                                          |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| #306 | `assertSafeOutputSighash`, `ALLOW_UNSAFE_OUTPUT_SIGHASH`, `toSignType` `hasOwnProperty` | `lib/wallet/sign-script.ts`                       |
| #308 | `hasScriptOptions` + sign-only refusal                                                  | `lib/wallet/sign-script.ts`, `LedgerSignTx.tsx`   |
| #310 | `hasUnsignableFields`, `LEDGER_UNSIGNABLE_FIELDS_MESSAGE`                               | `sign-script.ts`, `LedgerSignAndBroadcast.tsx:24` |
| #312 | `getDerivationFields`                                                                   | untouched                                         |

The only edit inside `sign-script.ts` is the L205 allocation; the diff is `-6,6 +6,7` (one import) and
`-198,11 +199,16` (the wrapped call). Every guard function is byte-identical to `main`.

**G8 — the one e2e failure.** `onboarding.spec.ts:7`, _"Test timeout of 30000ms exceeded while
setting up context"_. Re-ran once per the brief — failed again. Then checked out `main` (`a441e75`)
and ran it there: **fails identically**. This is a pre-existing environment failure, not a
regression from this branch.

Worth flagging honestly: the brief states this spec "has passed on recent runs". In this environment
it does not pass on `main` either, so either the environment differs or that note is stale.

---

## 5. QA build

`wxt.config.ts` was temporarily marked, built, verified, and reverted:

```
Kastle [W1 QA] | 2.59.5 | 2.59.5-w1-wasm-secret-lifecycle
```

`npm run build` exit 0. Marker reverted afterwards — the working tree carries **0 modified tracked
files**; `.output/chrome-mv3/` retains the marking. Load **that** directory, and confirm the manifest
shows `Kastle [W1 QA]` before trusting a single QA result.

### Build-fingerprint probe — with a correction

The brief prescribes: a script-free sign-only `signTx` returns _"cannot complete sign-only requests"_
on post-#308 builds, versus _"advanced scripts signing"_ / _"Method not implemented."_ on pre-#308.
The **behavioral** probe is correct and is the check to run in the field.

But the **static string grep is not a valid staleness test**, and I want that written down before it
misleads someone. `LedgerSignTx.tsx:28-29` is a single ternary:

```
? "…does not support advanced scripts signing"
: "…cannot complete sign-only requests yet…"
```

Both strings ship in the same post-#308 file, on the two branches of one conditional. Finding
`"advanced scripts signing"` in a bundle therefore proves **nothing** about staleness. Results on
this build:

| Marker                               | Present                       | Meaning                                                  |
| ------------------------------------ | ----------------------------- | -------------------------------------------------------- |
| `cannot complete sign-only requests` | ✅ `chunks/popup-Ccun89nk.js` | **post-#308 confirmed** — this is the only discriminator |
| `advanced scripts signing`           | ✅ same file                  | expected; the other ternary branch, not a signal         |
| `Method not implemented`             | ❌ absent                     | —                                                        |

The `:` branch is what #308 added, so its presence is the discriminator. The "script-free" qualifier
in the brief is exactly what selects that branch at runtime. **This build is post-#308.**

---

## 6. Manual QA checklist

Load `.output/chrome-mv3`. Confirm the manifest reads `Kastle [W1 QA] / 2.59.5-w1-wasm-secret-lifecycle`
first — a stale build silently answered an entire QA run once before, and version strings collide.

One extension per Chrome profile: two Kastle builds in one profile race to inject `window.kastle`.

| #   | Check                                            | Expected                                                     |
| --- | ------------------------------------------------ | ------------------------------------------------------------ |
| 1   | **Send on a new-derivation wallet**              | correct address derived, tx broadcasts, confirms             |
| 2   | **Send on a legacy wallet** ⚠️                   | correct address derived, tx broadcasts, confirms             |
| 3   | **Sign a message — new-derivation**              | signature produced and verifies                              |
| 4   | **Sign a message — legacy** ⚠️                   | signature produced and verifies                              |
| 5   | **Lock / unlock**                                | wallet re-derives, addresses **identical** to before locking |
| 6   | **dApp `signAndBroadcastTx`**                    | full round trip succeeds                                     |
| 7   | Import recovery phrase (type slowly, ~20+ chars) | validation still live per keystroke, no lag, no crash        |
| 8   | Import private key                               | validation still live, import succeeds                       |
| 9   | Account list with many addresses                 | all 50 legacy addresses render, unchanged                    |
| 10  | Ethereum account, both branches ⚠️               | addresses unchanged                                          |

⚠️ = touches the `isLegacy` landmine. **Rows 1–6 must be run on both wallet types**; a fix that works
on one branch and breaks the other is a wrong-key-signs bug, and rows 2/4/10 are the ones that catch it.

For rows 1–4, the highest-value check is simply: **is the derived address the same one that wallet
showed before this build?** If any address moved, stop.

---

## 7. Honest statement — what this does and does not achieve

**Achieved:**

- WASM secret objects in scopes that own them are freed **deterministically at last use** instead of
  waiting on GC that has no reason to run. Linear-memory growth from repeated signing, key derivation
  and keystroke-driven validation is bounded.
- The per-input `PrivateKey` on the signing path is freed per input rather than accumulating across a
  multi-input transaction.
- Freeing was proven safe by reading the wasm-bindgen glue — all callees borrow, none consume — not
  assumed.
- Both derivation branches are now pinned by tests at indexes where they actually differ.

**Not achieved — and this is the part that must not be glossed:**

- **Keys are not wiped from memory.** `free()` returns the allocation to the WASM allocator; it does
  **not** zero the bytes. The secret stays readable in linear memory until the allocator happens to
  reuse that region — which may be never. Freeing fixes reclamation outright and helps exposure only
  _probabilistically_.
- **Do not describe this work as "keys are now wiped from memory."** It is not what happened.
- The real fix for exposure is `zeroize` / `ZeroizeOnDrop` on the Rust side, upstream. It cannot be
  done from call sites, and this branch is call-sites-only by constraint.
- **The plaintext JS-string surface is untouched and is larger than what was fixed** (§P1.4).
  `LegacyHotWalletAccount` holds the master seed as a `protected readonly seed: string` for its whole
  life. Immutable JS strings cannot be zeroed. This is unaddressed and is arguably the more important
  finding of the whole investigation.
- Bucket **C** (`HotWalletPrivateKey`'s instance-held `PrivateKey`) is unaddressed pending a
  lifecycle contract.

A fair one-line characterization: _reclamation is now prompt and deterministic; exposure is reduced
but not eliminated, and the largest exposure surface is out of scope._

---

## 8. Upstream question for `@kcoin/kaspa-web3.js`

To raise with the maintainers — this is the actual fix for exposure:

> Do the secret-bearing types (`PrivateKey`, `Keypair`, `XPrv`, `Mnemonic`) zeroize their key
> material on drop?
>
> We can find no `zeroize` or `Zeroizing` symbols in the shipped `kaspa_bg.wasm`, while control
> symbols (`secp256k1`, `bip32`, `panicked`) are retained — so the absence looks meaningful rather
> than stripped, though inlining could explain it. Calling `free()` from JS deallocates but leaves
> the bytes readable in linear memory, which any script in the page can read as an `ArrayBuffer`.
>
> 1. Is `ZeroizeOnDrop` (or an equivalent manual wipe) applied to these types today?
> 2. If not, would you accept a PR adding it?
> 3. Separately: `toSeed()`, `Keypair.privateKey`, `XPrv.privateKey` and `PrivateKey.toString()`
>    return plain JS strings, which are immutable and can never be zeroed by the consumer. Is there
>    an API that keeps the secret WASM-side, or could one be added?

Question 3 is the one that matters most for us. Note that `@kcoin/kaspa-web3.js` and the WASM binary
are certified crypto inventory (audited 2026-07-29) — any upstream bump is a re-certification event,
not a routine dependency update.

---

## 9. Follow-ups (not in this branch)

1. **Upstream `ZeroizeOnDrop`** — §8. The only real fix for exposure.
2. **Bucket C lifecycle** — give `HotWalletPrivateKey` a disposal contract, then free its field.
3. **The JS-string seed surface** — depends on upstream question 3. Largest remaining exposure.
4. **`onboarding.spec.ts:7`** — fails on `main` in this environment; the brief believes it passes.
   Worth reconciling separately from this work.

---

## 10. Constraints honored

| Constraint                                | Status                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Call-site changes only                    | ✅                                                                     |
| No dependency change                      | ✅ G4, 0 lines                                                         |
| No `wasm/` change                         | ✅ G5, 0 lines (and `assets/`, where the binary actually lives)        |
| No `package*.json` change                 | ✅ G4                                                                  |
| Both `isLegacy` branches covered          | ✅ every touched derivation site, both classes, tests at indexes 0/1/3 |
| Shipped guards #306/#308/#310/#312 intact | ✅ G7                                                                  |
| No `FinalizationRegistry` added           | ✅                                                                     |
| Buckets B and D untouched                 | ✅                                                                     |
| Tests as deliverable, not afterthought    | ✅ 21 new                                                              |
| No push / PR / merge / tag / release      | ✅ none performed                                                      |
