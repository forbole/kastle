---
phase: testing
title: ZKas test strategy
description: Wallet and browser trust-boundary coverage
---

# ZKas test strategy

## Test Coverage Goals

Test each signing/broadcast trust boundary and relevant KAS/EVM regressions. Record local toolchain and testnet gaps separately.

## Unit Tests

- [x] Decimal ZKAS↔sompi rejects negatives, excess precision, scientific notation, and unsafe numbers.
- [x] Pinned WASM derives stable, network-correct addresses and distinct account indices; hash/genesis build guard passes.
- [x] Adapter rejects wrong network, daemon address substitution, malformed response, changed amount, excessive fee, and partial prepare before signing.
- [x] Unsupported account types fail during selection before signer or daemon access.
- [x] Privileged ZKas message sender helper rejects web-page, wrong-extension, malformed, and absent URLs; selection helper distinguishes accounts and networks.
- [x] Selection and grant guards are rechecked before submit; unit tests force a state change during the pre-submit callback after proof preparation and before daemon fetch.

## Integration Tests

- [x] Fake daemon sees FVK/token only; never phrase/seed.
- [x] Adapter sequencing calls a mock signer before submit; hostile or incomplete daemon responses fail before signing or submit.
- [ ] A valid mainnet bundle passes the pinned WASM verifier, and tampered bundles fail, using fixtures from a compatible daemon.
- [x] Failed preparation releases its reservation; uncertain submission persists and blocks a second send.
- [x] Account-scoped journal rejects concurrent reservations, survives service recreation, and retains uncertain outcomes until reviewed.
- [ ] Initialized-wallet browser integration confirms public-only account, balance, and receipt/error data. Source and schema review found no secret fields in page responses, and the installed-extension probe checked the final result relay.

## End-to-End Tests

- [x] Development extension + localhost page: provider discovery and existing Kaspa version probe; ZKas connect/account/send return locked or uninitialized errors before a wallet is set up.
- [x] Installed Chrome extension: accepted same-origin result reaches the page and receives `{accepted:true}`; mismatched-origin result is rejected with `{accepted:false}`.
- [ ] Initialized wallet: complete connection, account/balance, denial, and approval against a compatible daemon.
- [ ] Popup: asset → receive → send → confirm → result.
- [ ] Account/network switch and lock during request fail closed.
- [ ] Existing Kaspa send and connection regression checks pass.

## Test Data

Synthetic BIP39 phrases only in source tests. A funded mainnet account and daemon URL must be supplied out of band for an optional live payment. The pinned signer refuses testnet payments.

## Test Reporting & Coverage

Record exact results of `npm run compile`, `npm run lint`, `npm run build`, and targeted Playwright specs per milestone. Native `canvas` setup is a host limitation.

M1: 13 ZKas focused Playwright tests pass; TypeScript compile and ESLint pass (39 preexisting warnings). Runtime WASM hash rejection, testnet signing rejection, uncertain submit results, and address binding have targeted tests. Build and broader regressions are pending the feature wiring.

M2: 23 focused tests pass; TypeScript compile, Chrome build, and ESLint pass (39 preexisting warnings). The Chrome content script contains no ZKas signer symbols after separating shared API utilities from background keyring code. These results use a fake daemon and do not establish compatibility with a running walletd or a funded payment.

M3/M4: 35 focused ZKas tests pass; TypeScript compile, Chrome and Firefox builds, and ESLint pass (39 existing warnings). An isolated installed-Chrome probe confirms provider discovery, Kaspa version response, locked/uninitialized ZKas errors, and both accepted and rejected final-result acknowledgements. Astra converged with no P0/P1/P2 findings. The final Codex Security M3b diff scan covered 21 source files with zero findings after the result-delivery defect was fixed. A broad Playwright run and a single existing Kaspa batch spec both stalled before test discovery under Node 26 on this host and were stopped; they are not counted as passes.

## Manual Testing

- [x] Serve page from loopback; confirm provider discovery and the existing Kaspa API probe.
- [ ] Initialize an extension wallet and confirm one ZKas connection approval.
- [ ] Check address, balance/sync warning, QR/copy, fee, denial, and result copy.
- [ ] Confirm no phrase, FVK, token, or signatures appear in page state or network calls.
- [x] Check Chrome and Firefox production builds.

## Performance Testing

Proofs can take tens of seconds. Confirm progress, timeout behavior, and no duplicate submission. No load test is needed for one extension user.

## Bug Tracking

Record each failing test or review finding in the planning doc, then fix and rerun the relevant gate before the next commit.
