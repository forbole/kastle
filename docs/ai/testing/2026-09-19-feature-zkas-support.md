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
- [ ] Unsupported account types never invoke signer or daemon.
- [ ] Origin/selected-account guard rejects unconnected or stale requests.

## Integration Tests

- [x] Fake daemon sees FVK/token only; never phrase/seed.
- [ ] Valid prepared bundle reaches `verify_and_sign_payment` before submit; malicious prover cannot submit.
- [ ] Failed proof does not retry into duplicate send.
- [ ] UI/page receive only public data and errors with no key material.

## End-to-End Tests

- [ ] Development extension + localhost page: discover, connect, read account/status/balance, deny and approve send against fake daemon.
- [ ] Popup: asset → receive → send → confirm → result.
- [ ] Account/network switch and lock during request fail closed.
- [ ] Existing Kaspa send and connection regression checks pass.

## Test Data

Synthetic BIP39 phrases only in source tests. A funded mainnet account and daemon URL must be supplied out of band for an optional live payment. The pinned signer refuses testnet payments.

## Test Reporting & Coverage

Record exact results of `npm run compile`, `npm run lint`, `npm run build`, and targeted Playwright specs per milestone. Native `canvas` setup is a host limitation.

M1: 13 ZKas focused Playwright tests pass; TypeScript compile and ESLint pass (39 preexisting warnings). Runtime WASM hash rejection, testnet signing rejection, uncertain submit results, and address binding have targeted tests. Build and broader regressions are pending the feature wiring.

## Manual Testing

- [ ] Serve page from localhost; confirm provider discovery and one connect approval.
- [ ] Check address, balance/sync warning, QR/copy, fee, denial, and result copy.
- [ ] Confirm no phrase, FVK, token, or signatures appear in page state or network calls.
- [ ] Check Chrome and Firefox builds if toolchains are available.

## Performance Testing

Proofs can take tens of seconds. Confirm progress, timeout behavior, and no duplicate submission. No load test is needed for one extension user.

## Bug Tracking

Record each failing test or review finding in the planning doc, then fix and rerun the relevant gate before the next commit.
