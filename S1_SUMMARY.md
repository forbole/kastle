# S1 — Sentry secret scrubbing + W1b Tier-1 cleanup

Branch `fix/sentry-secret-scrubbing`, based on `main` @ `8d3d801`.

**Base note:** the task specified `main` @ `6637ad9`. `main` has since advanced to
`8d3d801` (`chore(main): release 2.59.6`), which is a release-please version bump only
— no source change. Basing on `8d3d801` keeps the branch on current `main` and keeps
G4 honest (a branch cut at `6637ad9` would show a spurious `package.json` diff).

Two commits:

| SHA       | Subject                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| `6d8aaeb` | `fix: scrub secret material from Sentry events and breadcrumbs`                    |
| `2bcd44a` | `fix: drop dead getPrivateKeys and stop materialising keys as hex for signMessage` |

```
 lib/instrument.ts                            |   9 ++
 lib/sentry-scrub.ts                          | 112 +++++++++++++++++
 lib/wallet/account/hot-wallet-account.ts     |  30 +----
 lib/wallet/account/hot-wallet-private-key.ts |   5 +-
 tests/signtx-unit.spec.ts                    | 175 +++++++++++++++++++++++++++
 5 files changed, 306 insertions(+), 25 deletions(-)
```

---

## P0 — What Sentry actually captured

### a. Package and version

`package.json` declares `"@sentry/react": "^9.0.0"`. Installed and locked:
`@sentry/react`, `@sentry/browser` and `@sentry/core` all **9.12.0**.

`sendDefaultPii`'s effective default in 9.12.0: **unset**. `applyDefaultOptions()` in
`node_modules/@sentry/browser/build/npm/cjs/sdk.js` sets only `defaultIntegrations`,
`release` and `sendClientReports` — `sendDefaultPii` is never defaulted, so it arrived
as `undefined` and every consumer read it as falsy. Falsy-by-accident, not false-by-
contract, which is why it is now set explicitly.

In the browser SDK the option has a narrow blast radius anyway: its only readers are
`requestDataIntegration` (IP address) and `trpcMiddleware`, neither of which is in the
browser default set. It was **not** the vector.

### b. Session Replay — OFF (confirmed, not assumed)

This is the question that would have escalated the finding to confirmed-critical, and
the answer is no, on three independent checks:

1. `replayIntegration` is **absent from `getDefaultIntegrations()`** in
   `@sentry/browser` 9.12.0 (full list in P0c below).
2. There is exactly one `Sentry.init` in the repo and it passes no `integrations`
   array, so nothing adds it.
3. `grep -rl "replayIntegration" .output/` over the **built extension** returns
   nothing. Not merely unconfigured — absent from the shipped bytes.

No DOM capture of the displayed phrase was ever in play. Nothing to disable; S1.3 is a
no-op, deliberately.

### c. Default integrations in 9.12.0

From `getDefaultIntegrations()`:

`inboundFilters`, `functionToString`, **`browserApiErrors`**, **`breadcrumbs`**,
**`globalHandlers`**, `linkedErrors`, `dedupe`, `httpContext`, `browserSession`.

`breadcrumbsIntegration`'s defaults are all-on, including **`console: true`** and
`dom: true`. The console handler joins the logged arguments with `safeJoin()` straight
into `breadcrumb.message`, and attaches `handlerData.args` as the hint.

**So the plausible vector was real and was exactly as suspected:** console breadcrumbs
plus `globalHandlers`. Any `console.*` argument, and any unhandled error or rejection
message, was serialised verbatim into the outbound envelope with nothing between it and
the wire.

### d. Screens holding secret material

`ShowWalletSecret.tsx` gates on a `WalletSecret` in `useState` and hands `secret.value`
as a prop to `ShowRecoveryPhrase` / `ShowPrivateKey`, which render the phrase word by
word into `<input>` elements. Files that reference `mnemonic` / `privateKey` /
`phrase` / `passphrase` in the UI and hook layers:

```
components/onboarding/ChooseImport.tsx
components/screens/AddWallet.tsx
components/screens/Dashboard.tsx
components/screens/Onboarding.tsx
components/screens/full-pages/ImportPrivateKey.tsx
components/screens/full-pages/ImportRecoveryPhrase.tsx
components/screens/full-pages/ImportRecoveryPhraseWithPassphrase.tsx
components/screens/full-pages/account-management/ManageAccounts.tsx
components/screens/full-pages/show-wallet-secret/ShowPrivateKey.tsx
components/screens/full-pages/show-wallet-secret/ShowRecoveryPhrase.tsx
components/screens/full-pages/show-wallet-secret/ShowWalletSecret.tsx
components/side-menu/RecoveryPhraseWalletItem.tsx
components/side-menu/SideMenu.tsx
entrypoints/popup/router.tsx
hooks/wallet/useAccountManager.ts
hooks/wallet/useWalletImporter.ts
ui/full-page/import-passphrase/ImportPassphrasePage.tsx
ui/full-page/import-recovery-phrase/ImportRecoveryPhrasePage.tsx
ui/full-page/import-wallet/ImportWalletPage.tsx
ui/general/PassphraseInfoModal.tsx
ui/popup/add-wallet/AddWalletPage.tsx
```

All of them live in the popup, which is the one entry point that loads Sentry.

### e. `console.*` reachable from those screens

32 call sites across `components/ hooks/ ui/ lib/ entrypoints/ contexts/`. **None logs
a secret directly** — they are almost entirely `console.error(error)` in `catch`
blocks, plus one `console.log` banner in `entrypoints/popup/main.tsx`.

That is the honest read, and it is why the original status was INFERRED. The exposure
was never "we log the phrase today"; it was that the import and backup flows pass raw
phrases through code whose `catch` blocks log the caught error unconditionally, with no
scrubbing between that and Sentry. One WASM error string or one added debug line was
the whole distance to a leak.

### f. `Sentry.init` call sites — exactly one

`lib/instrument.ts`, imported only by `entrypoints/popup/main.tsx`. The background
service worker and the content scripts do not initialise Sentry. One site to fix.

**P0 verdict:** Session Replay off, `sendDefaultPii` inert, but console breadcrumbs and
`globalHandlers` on and unscrubbed. Passive continuous exposure with a short fuse, and
the fix is cheap — so it ships regardless.

---

## S1 — The fix

### `lib/sentry-scrub.ts` (new, 112 lines)

Pure and Sentry-independent so it unit tests directly. `scrubPayload()` walks an
arbitrary payload recursively and redacts by two independent rules:

**By pattern**, applied to every string:

| Rule            | Pattern                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BIP-39 phrase   | ≥ 12 consecutive dictionary words. Separators between the words are not inspected, so a phrase pasted with commas, newlines or numbering is still caught. |
| Private key hex | `\b(?:0x)?[0-9a-fA-F]{64}\b` — covers secp256k1 and Kaspa private keys, bare or `0x`-prefixed.                                                            |
| Extended key    | `\b[xk]prv[0-9A-Za-z]{20,}\b` — BIP-32 `xprv…` and the Kaspa `kprv…` variant.                                                                             |

**By field name**, matched case-insensitively against
`seed|mnemonic|privatekey|phrase|passphrase|password|secret|xprv`. A matching key has
its value replaced whatever the value is — string, number, `null`, or a whole nested
object. This catches `privateKeyString` and `seedSource` via substring, by design.

**Recursion.** The walk covers the entire payload — `message`, `exception.values`,
`breadcrumbs[].data`, `extra`, `contexts`, `request`, arrays, and anything nested at any
depth. A `WeakSet` breaks cycles (a repeat resolves to `[REDACTED]`). Objects with no
enumerable own keys — `Error`, `Date`, class instances — are handed back untouched
rather than rebuilt into `{}`, which would have destroyed the payload; Sentry serialises
those itself.

**Fail-safe.** The whole walk is wrapped. If redaction throws for any reason,
`scrubPayload` returns `null`, and Sentry treats `null` from `beforeSend` /
`beforeBreadcrumb` as _drop_. It fails closed, never sending an unscrubbed payload.

The BIP-39 wordlist comes from `viem`, which is already a **direct** dependency and
already imported by `lib/utils.ts`. No dependency change, no new bundle cost, and no
hand-rolled word heuristic that would have over-redacted ordinary prose.

### `lib/instrument.ts`

```ts
Sentry.init({
  dsn: "…",
  enabled: isProduction,
  sendDefaultPii: false,
  beforeSend: (event) => scrubPayload(event),
  beforeBreadcrumb: (breadcrumb) => scrubPayload(breadcrumb),
});
```

- **S1.1** — both hooks wired, recursive, fail-closed. ✅
- **S1.2** — `sendDefaultPii: false` set explicitly, not inherited. ✅
- **S1.3** — Session Replay is off and absent from the build; nothing to disable or
  mask. Stated rather than changed. ✅
- **S1.4** — one `Sentry.init` site exists and it is this one. ✅
- **S1.5 — skipped, deliberately.** Disabling Sentry on secret-bearing routes is not a
  clean few lines here: the SDK has no route predicate, so it would mean either a
  module-level mutable flag that every secret screen sets and clears on mount/unmount
  (leaks on an unmount that never fires, and races with async errors that surface after
  navigation), or threading the router state into `beforeSend`. Both are more moving
  parts than the control they would back up. The scrubber is route-independent and
  covers every screen including ones not written yet, which is the stronger property.

**Verified in the built bundle, not just the source:** `.output/chrome-mv3/chunks/popup-*.js`
contains `[REDACTED]`, `sendDefaultPii: false`, `beforeSend: (event) => scrubPayload(event`,
`beforeBreadcrumb: (breadcrumb) => scrubPayload(`, and the BIP-39 wordlist.

---

## S2 — Tests

12 tests in `tests/signtx-unit.spec.ts` under `sentry secret scrubbing`, exercising the
redactor directly:

| #   | Test                                                                                                                       | Covers                          |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | 12-word BIP-39 phrase in a message                                                                                         | required                        |
| 2   | 24-word BIP-39 phrase in a message                                                                                         | required                        |
| 3   | phrase pasted with commas and newlines                                                                                     | separator robustness            |
| 4   | 64-char hex key, bare **and** `0x`-prefixed                                                                                | required                        |
| 5   | `xprv…` extended key                                                                                                       | required                        |
| 6   | secrets nested in `extra`, `contexts` and a breadcrumb's `data`                                                            | required (nested)               |
| 7   | a breadcrumb payload scrubbed like an event                                                                                | `beforeBreadcrumb` path         |
| 8   | field-name match with harmless values (`"hello"`, `42`, `""`, `null`, nested object) — **and** a non-secret key left alone | required (field-name)           |
| 9   | benign event passes through `toEqual`-unchanged                                                                            | required (over-redaction guard) |
| 10  | ordinary long English prose untouched                                                                                      | over-redaction guard            |
| 11  | scrubber throws → returns `null` → event dropped                                                                           | required (fail-safe)            |
| 12  | cyclic payload neither hangs nor leaks                                                                                     | robustness                      |

Tests 9 and 10 are the ones that keep Sentry useful: 9 asserts deep equality on a
realistic error event carrying a Kaspa **address** (superficially key-like) and a
version string, and 10 asserts a 24-word English sentence survives intact.

---

## S3 — W1b Tier-1 cleanup

Both items verified independently. The W1b findings were not taken on trust.

### S3.1 — `getPrivateKeys()` ×2 — **deleted**

Zero callers, verified two ways before deleting:

- `graphify query` on the graph at `~/Repositories/kastle/graphify-out/graph.json`.
- `grep -rn "getPrivateKeys" .` across the whole repo including `tests/`, excluding
  only `node_modules/.git/.output/dist`. Result: **two definition lines**
  (`hot-wallet-account.ts:74`, `:121`) and four hits in `W1_INVESTIGATION.md` /
  `W1_SUMMARY.md`, which are prose. No call site anywhere.

The W1b claim that the override ignores its `indexes` parameter is confirmed by the
source _and_ corroborated independently by eslint: the baseline run flagged
`hot-wallet-account.ts:121:27 'indexes' is defined but never used`, and deleting the
methods is exactly what removes it (40 → 39 warnings, diffed below).

### S3.2 — `signMessage` object passing — **applied**, ownership confirmed empirically

`ISignMessage.privateKey` is typed `PrivateKey | string` (`wasm/core/kaspa.d.ts:2515`),
so the object form is supported. The question W1 raised is whether the WASM boundary
_borrows_ or _consumes_, and that could not be settled by reading compiled glue — so it
was measured against the built `assets/kaspa_bg.wasm` with a throwaway spec:

| Probe                                          | Result                                      |
| ---------------------------------------------- | ------------------------------------------- |
| `signMessage` twice with the same `PrivateKey` | both succeed                                |
| `pk.toString()` after signing                  | succeeds — pointer still live               |
| `pk.free()` after all of the above             | succeeds — **this** was the first real free |
| `pk.free()` a second time                      | throws `Error: null pointer passed to rust` |
| object path vs string path, `noAuxRand: true`  | **byte-identical signature**                |

Same shape as `createInputSignature` in W1: **borrows, caller retains ownership and
must free.** The double-free throwing is the load-bearing receipt — it proves
`signMessage` did not null the pointer, because if it had, the first `free()` would have
been the one to throw.

(The first probe run without `noAuxRand` produced differing signatures each call. That
is Schnorr aux randomness, not a semantic difference — `noAuxRand: true` makes it
deterministic and the two paths then agree byte for byte.)

Applied in two places:

- `hot-wallet-account.ts:58` — `getPrivateKey()` documents that it hands ownership to
  the caller, so the object is wrapped in `withOwned` and freed:
  ```ts
  return withOwned((own) =>
    signMessage({ message, privateKey: own(this.getPrivateKey()) }),
  );
  ```
  `withOwned` is sync-only and `signMessage` returns synchronously, so the
  #324 thenable guard is not in play.
- `hot-wallet-private-key.ts:37` — the instance owns `this.privateKey` for its whole
  lifetime (constructed inline at `account-factory.ts:38,67`, no other reference, never
  freed), so the object is passed directly with **no** `withOwned`.

Both drop a hex private key string that was previously materialised in JS memory purely
to hand back to WASM.

**Coverage.** `HotWalletAccount.signMessage` was already covered — the W1 suite calls it
20 times per variant across 6 legacy/new × index combinations, asserting a valid
128-hex signature, which is a strong repeated-use / no-use-after-free receipt for the
`withOwned` change. `HotWalletPrivateKey` had **no** coverage, so one test was added:
20 repeated calls plus a byte-identical comparison against the string path under
`noAuxRand`.

### S4 — out of scope, untouched

`sign-script.ts` object passing, any seed/`Uint8Array` refactor, Sentry token rotation,
and `ledger-account.ts` — all confirmed 0-byte diff (G4/G5/G6 below).

---

## Gauntlet receipts

Every check run with the direct binary under Node 20 (`v20.20.2`), output redirected to
a file, exit code read from `$?` on the line immediately after the command and **outside
any pipe**. Final full pass, all green:

| Gate | Command                                                         | Result                            | How verified                                                 |
| ---- | --------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| G1   | `./node_modules/.bin/tsc --noEmit`                              | **exit 0**                        | `$?` immediately after, no pipe                              |
| G2a  | `./node_modules/.bin/eslint .`                                  | **exit 0**, 39 warnings, 0 errors | `$?` after; output diffed against baseline (below)           |
| G2b  | `./node_modules/.bin/prettier --check .`                        | **exit 0**                        | `$?` after; "All matched files use Prettier code style!"     |
| G3   | `playwright test tests/signtx-unit.spec.ts --reporter=line`     | **exit 0**, **76 passed**         | `$?` after; 63 baseline + 12 S2 + 1 S3                       |
| G4   | `git diff main -- package.json package-lock.json wasm/ assets/` | **0 bytes**                       | `wc -c` on the redirected diff                               |
| G5   | `git diff main -- lib/wallet/account/ledger-account.ts`         | **0 bytes**                       | `wc -c` on the redirected diff                               |
| G6   | shipped guards                                                  | **all 0 bytes**                   | see below                                                    |
| G7   | `playwright test --reporter=line`                               | **76 passed, 1 failed**           | only `onboarding.spec.ts:7` — the known pre-existing failure |

### G2 eslint — against a baseline captured before the first edit

The baseline was captured on the unmodified tree before any edit. Note that a first
attempt to size it via `wc -l < file` reported `0` for a file that is 6.3 KB on disk —
the `rtk` shim fabricating output, exactly as warned. All subsequent comparisons use
`diff(1)` on the redirected files and `ls -l` for size.

Baseline vs final, complete:

```
105,107d104
< /Users/leonardo/Repositories/s1/lib/wallet/account/hot-wallet-account.ts
<   121:27  warning  'indexes' is defined but never used  @typescript-eslint/no-unused-vars
<
111c108
< ✖ 40 problems (0 errors, 40 warnings)
---
> ✖ 39 problems (0 errors, 39 warnings)
```

The only change is a **removal**. No new warning anywhere, and none of the 39 remaining
touches the five changed files.

### G3 — 76 passing

63 on the unmodified tree (the brief said 62; the tree has 63), + 12 S2 + 1 S3 = 76.

### G6 — shipped guards byte-identical

Every guard verified at 0 bytes of diff against `main`:

| PR   | Guard                                                    | File                                        | Diff    |
| ---- | -------------------------------------------------------- | ------------------------------------------- | ------- |
| #306 | `assertSafeOutputSighash`, `ALLOW_UNSAFE_OUTPUT_SIGHASH` | `lib/wallet/sign-script.ts`                 | 0 bytes |
| #306 | `toSignType` `hasOwnProperty` (`lib/kaspa.ts:68`)        | `lib/kaspa.ts`                              | 0 bytes |
| #308 | `hasScriptOptions` + sign-only refusal                   | `lib/wallet/sign-script.ts`                 | 0 bytes |
| #310 | `hasUnsignableFields`                                    | `lib/wallet/sign-script.ts`                 | 0 bytes |
| #310 | `LEDGER_UNSIGNABLE_FIELDS_MESSAGE`                       | `components/.../LedgerSignAndBroadcast.tsx` | 0 bytes |
| #312 | `getDerivationFields`                                    | `api/background/utils.ts`                   | 0 bytes |
| #324 | `withOwned` thenable guard                               | `lib/wallet/wasm-lifecycle.ts`              | 0 bytes |

Stronger statement: `git diff --name-only main...HEAD` filtered to exclude the five
intended files returns **zero** files.

### G7 — the one failure is the known one

```
1) [chromium] › tests/onboarding.spec.ts:7:1 › can reach password setup
   Test timeout of 30000ms exceeded while setting up "context".
1 failed, 76 passed
```

Pre-existing and deterministic on unmodified `main` in this environment, per the brief.
Not touched, not "fixed".

**Gauntlet passes used: 2.** Pass 1 green after S1+S2. Pass 2 restarted after the S3
edits (one prettier re-format on `hot-wallet-account.ts`, then green).

---

## QA build

```
~/Desktop/kastle-qa-s1/          (38 MB, chrome-mv3, manifest v3)
```

Built with `npm run build` (exit 0). The manifest was marked **post-build only** and
read back off disk to verify:

```json
{
  "name": "Kastle (QA S1 2bcd44a)",
  "version": "2.59.6",
  "version_name": "2.59.6-s1-qa-2bcd44a"
}
```

`npm run build` is a production build, so `isProduction` is true and **Sentry is
enabled in this build** — which is what makes the check below possible at all. Load it
in a Chrome profile that has no other Kastle build installed: two injectors racing on
`window.kastle` will produce misleading results.

---

## How to prove nothing secret leaves

The unit tests prove the redactor. This proves the **wiring** — that the redactor is
actually on the path to the network.

1. **Load the QA build.** `chrome://extensions` → Developer mode → Load unpacked →
   `~/Desktop/kastle-qa-s1/`. Confirm the tile reads `Kastle (QA S1 2bcd44a)`.

2. **Import a known throwaway phrase.** Use a phrase you can grep for and would never
   fund, e.g.
   `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`.

3. **Open the popup in a full tab**, not the toolbar bubble — the bubble closes when
   focus moves to devtools. Copy the extension ID from `chrome://extensions` and open
   `chrome-extension://<ID>/popup.html`. Navigate to the backup screen so the phrase is
   on screen.

4. **Open devtools on that tab → Network → filter `sentry.io`.**

5. **Trigger a deliberate error carrying the phrase.** In the Console:

   ```js
   const CANARY =
     "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
   console.log("QA-CANARY", CANARY); // -> console breadcrumb
   setTimeout(() => {
     throw new Error("QA-CANARY " + CANARY);
   }); // -> globalHandlers event
   ```

   The `console.log` exercises `beforeBreadcrumb`; the thrown error exercises
   `beforeSend` and carries the breadcrumb with it. Those are the two vectors P0
   identified.

6. **Inspect the outbound envelope.** Click the request to `…ingest.us.sentry.io/…/envelope/`
   → Payload / Request. Search it for `abandon`.

**Pass:** zero occurrences of `abandon`. The message and the breadcrumb both read
`QA-CANARY [REDACTED]`. **Fail:** any fragment of the phrase appears anywhere in the
envelope.

Worth repeating step 5 with a hex key and an `xprv`, which cover the other two patterns:

```js
console.log(
  "QA-CANARY",
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef",
);
setTimeout(() => {
  throw new Error(
    "QA-CANARY xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi",
  );
});
```

And one negative control, to confirm Sentry still works and the scrubber is not simply
eating everything:

```js
setTimeout(() => {
  throw new Error("QA-CANARY benign network timeout");
});
```

That envelope **should** contain `QA-CANARY benign network timeout` verbatim.

---

## Canary / negative-control verification (Part A + Part B)

### Part A — automated, `tests/signtx-unit.spec.ts`

`test.describe("sentry scrubbing wired into a real client")`, 4 tests. These
drive a **real `@sentry/react` client** — same SDK, same event pipeline as
production — differing only in a fake DSN (`https://abc123@o0.ingest.sentry.io/0`)
and an in-memory `transport` that pushes envelopes into an array. **Nothing
touches the network.** The hooks are `sentryScrubHooks` imported from
`lib/sentry-scrub.ts`, not a copy: the redaction under test is the redaction
that ships.

| Test                                                                   | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| canary: a phrase, a hex key and an xprv are all gone from the envelope | A 12-word phrase, a 64-hex key and an `xprv…` planted in a breadcrumb message, breadcrumb `data.arguments`, the error message, `extra.mnemonic`, `extra.nested.xprv` and `contexts.wallet.imported[0].raw` are all absent from the serialised envelope. Checked by recursing the **whole** envelope — headers, item headers, event body, arrays, any depth — not just top-level keys. Also asserts the fragments `abandon` and `xprv9s21` are absent, so a partial redaction cannot pass.                                                                                                                                                   |
| negative control: a benign event arrives unchanged                     | An error message, a URL, a Kaspa address and a breadcrumb all arrive **verbatim**, and `[REDACTED]` appears nowhere. Without this, "nothing came through" and "scrubbing worked" are indistinguishable.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| each captureException produces exactly one envelope                    | One `captureException` → exactly one envelope, for both a secret-bearing and a benign error. A fail-closed scrubber that ate everything would show 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| lib/instrument.ts actually applies these hooks to Sentry.init          | Source-level drift guard: `lib/instrument.ts` contains `Sentry.init(` and `...sentryScrubHooks`. It is source-level because `instrument.ts` cannot be imported into the Playwright runner — it pulls `lib/utils.ts` and with it the app's asset graph, which the test transform cannot load (`SyntaxError: … '@/assets/images/network-logos/igra.svg' does not provide an export named 'default'`). That import failure is why `sentryScrubHooks` lives in `lib/sentry-scrub.ts` behind a **type-only** `@sentry/react` import (erased at compile time, so the module stays runtime-independent of the SDK) and `instrument.ts` spreads it. |

One wrinkle worth recording: Sentry's scopes are module-global and survive
`init`/`close`, so the canary's breadcrumbs initially rode along inside the
control envelope and failed the negative control. `withIsolationScope` did not
fix it; the helper now calls `clearBreadcrumbs()` on the global, isolation and
current scopes before each capture.

### Part B — manual, Settings → Experimental features (dev builds only)

**There is no existing build-time debug gate in this repo.** The only debug-ish
UI is the `/dev-mode` screen, and it is gated on the _runtime_ `settings.preview`
checkbox — it ships in production. So the trigger uses `import.meta.env.DEV`,
and the stripping is proven below rather than assumed (`wxt.config.ts` sets
`minify: false`, so dead-code elimination, not minification, has to do the work).

Steps for Leo:

1. `nvm use 20 && npm run dev`, load `.output/chrome-mv3` in a profile with no
   other Kastle build.
2. Popup → **Settings** → **Experimental features**.
3. Open the popup devtools console (right-click the popup → Inspect).
4. Click **Trigger canary error** → the console prints
   `[sentry-canary] { … }` — the full envelope JSON. Search it for `abandon`,
   for the hex key, for `xprv9s21`: all absent, `[REDACTED]` in their place.
5. Click **Trigger control error** → `[sentry-control] { … }` — the URL, the
   status and the error text are all there, untouched, and `[REDACTED]` appears
   nowhere.

Why it prints instead of sending: the app's client is `enabled: isProduction`,
so in a dev build `captureException` emits nothing at all and there would be
nothing to look at. The trigger therefore builds its own client from the same
`sentryScrubHooks` with a stub transport, and logs what would have gone on the
wire. Nothing leaves the machine, and no event reaches the real Sentry project.

### Production build is clean

```
npm run build            → exit 0
grep -rl "Trigger canary error" .output/   → exit 1 (no matches)
grep -rl "abandon abandon" .output/        → exit 1 (no matches)
grep -rl "emitCanaryEnvelope" .output/     → exit 1 (no matches)
```

The button text, the test phrase and the handler are all absent from the
production bundle. The `import.meta.env.DEV` gate strips the block.

### Gauntlet, re-run after Part A + B

- `tsc --noEmit` → 0
- `eslint .` → 39 warnings, identical to the baseline
- `prettier --check .` → 0
- `playwright test tests/signtx-unit.spec.ts` → **80 passed** (76 existing + 4 new)
- `git diff main...HEAD -- package.json package-lock.json wasm/ assets/ ledger-account.ts` → 0 bytes

## Human gates — nothing done past the working tree

No push, no PR, no tag, no merge, no release. Two local commits on
`fix/sentry-secret-scrubbing` in `~/Repositories/s1`, and a QA build on the Desktop.

## Left undone, deliberately

- **S1.5 route-aware Sentry disabling** — skipped; rationale under S1 above.
- **No end-to-end test through the real Sentry client.** The redactor has 12 unit
  tests and the built bundle was grepped to confirm the hooks and `sendDefaultPii` are
  present in the shipped bytes, but nothing in the gauntlet drives an actual
  `Sentry.captureException` through a mock transport. That would need transport
  scaffolding the brief explicitly warned off; the manual check above covers the same
  ground with better fidelity, against the real build. If you would rather have it in
  CI than in a runbook, say so and it is maybe 30 lines with a stub transport.
- **Sentry token rotation** — out of scope per S4, untouched.
