---
phase: planning
title: ZKas implementation plan
description: Small reviewed milestones
---

# ZKas implementation plan

## Milestones

- [ ] M1: Pinned signer and typed non-custodial core.
- [ ] M2: Asset, receive, send, and daemon settings workflow.
- [ ] M3: Origin-gated browser API and standalone local test page.
- [ ] M4: Tests, docs, and review convergence.

## Task Breakdown

### M1 Foundation

- [x] Pin signer JS/WASM, source revision, SHA-256, license declaration, and genesis check; verify address/account vectors. Upstream license texts still need release verification.
- [x] Implement exact sompi parsing and typed daemon checks; watch-only registration and full-payment prepare/sign/submit.
- [ ] Test changed amount, inflated fee, wrong network, incomplete sync, malformed response, unsupported account, and no signing on failure. All except unsupported account are covered in M1; keyring integration is M2.
- [ ] Commit and run Astra plus Codex Security diff reviews; fix blockers.

### M2 Wallet

- [ ] Add per-network user-selected daemon URL and optional host permission.
- [ ] Wire background keyring to ZKas account derivation; fail closed on unsupported types.
- [ ] Add asset, receive, balance/sync, and send details/confirm/result.
- [ ] Test account switch, lock, fee display, and one in-flight send; commit and review.

### M3 Browser API

- [ ] Add connected-origin read methods and fresh send approval.
- [ ] Add localhost page for provider discovery, account/balance, and optional approved send.
- [ ] Test denial, wrong origin, stale account, malformed request, and page secrecy; commit and review.

### M4 Convergence

- [ ] Run compile, lint, build, targeted tests, and manual extension/page checks.
- [ ] Update public API/operator docs with setup, privacy, supported accounts, and limits.
- [ ] Repeat Astra and Codex Security review after fixes until no blocking finding remains.

## Dependencies

- Compatible ZKas walletd/node and funded mainnet account for a live payment smoke test. The pinned signer refuses testnet payments.
- Project needs Node 20. This host has Node 26 and an unaccepted Xcode license; native `canvas` install fails. Script-free dependencies allow type/lint checks.
- AI DevKit task CLI returned `unknown command 'task'`; progress lives here.
- Current task branch is `kwun/zkas-support`; AI DevKit's `feature-zkas-support` branch-name lint check is expected to fail while retaining it.

## Risks & Mitigation

- Hostile or wrong daemon: check network/state and amount/fee; WASM verifies the prepared bundle.
- Viewing privacy: explicit daemon choice and no credentials in page API.
- Recovery mismatch: pinned ZIP-32 path and vectors; unsupported wallet types disabled.
- Partial send: fail before broadcast when the full amount cannot fit.
