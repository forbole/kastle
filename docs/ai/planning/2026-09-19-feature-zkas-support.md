---
phase: planning
title: ZKas implementation plan
description: Small reviewed milestones
---

# ZKas implementation plan

## Milestones

- [x] M1: Pinned signer and typed non-custodial core (`b0fb5e0`).
- [x] M2: Asset, receive, send, and daemon settings workflow (`4b0ec35`, `463b579`, `1058a02`).
- [x] M3: Origin-gated browser API and standalone local test page (`38278d1`, `7078337`).
- [x] M4: Local tests, docs, Astra review, and Codex Security review converged. External release checks remain below.
- [x] M5: Move ZKas into the Network picker behind Experimental features; guard popup and background access, test and review the change. Astra found and verified fixes for balance masking and the backup warning. Codex Security reviewed the final 16 changed source files with zero findings.
- [x] M6: Import an explicit `shielded-pay` spending seed into an imported-key account, with address preview, encrypted storage, backup, concurrency tests, and independent security review. Astra's second pass found no remaining actionable issue. Codex Security scan `d5849c25-1c95-4ca9-9f79-cda66e4f95c4` reviewed all 17 changed source files with zero findings; it did not audit signer WASM internals or a funded mainnet payment.
- [x] M7: Move ZKas seed import into Import Wallet as a separate wallet, filter the wallet switcher by active network, preserve old attached seeds for reading, and guard Kaspa-only balance and signing paths. TypeScript, lint, Chrome build, and 54 focused tests pass. Astra found no remaining P0–P2 issue. Final Codex Security scan `04e9e70f-74d9-4a33-811f-76b81e4c7b87` reviewed 26 changed source files with zero attacker-reachable findings. Initialized-wallet UI and funded-payment checks remain external release checks.
- [x] M9: Require and validate daemon setup before ZKas selection or wallet creation/import; disclose FVK visibility; use the current daemon birthday only for immediate new-wallet registration and use genesis for restored wallets and every later registration; bind registration to the approved daemon; protect cross-window settings writes; verify, review, document, and build the unpacked extension.

## Task Breakdown

### M1 Foundation

- [x] Pin signer JS/WASM, source revision, SHA-256, license declaration, and genesis check; verify address/account vectors. Upstream license texts still need release verification.
- [x] Implement exact sompi parsing and typed daemon checks; watch-only registration and full-payment prepare/sign/submit.
- [x] Test changed amount, inflated fee, wrong network, incomplete sync, malformed response, unsupported account, and no signing on failure.
- [x] Commit and run Astra plus Codex Security diff reviews; fix blockers.

### M2 Wallet

- [x] Add per-network user-selected daemon URL and optional host permission.
- [x] Wire background keyring to ZKas account derivation; fail closed on unsupported types.
- [x] Add asset, receive, balance/sync, and send details/confirm/result.
- [x] Test account switch, lock, fee ceiling, and one in-flight send; commit and review.

### M3 Browser API

- [x] Add connected-origin read methods and fresh send approval.
- [x] Add localhost page for provider discovery, account/balance, and optional approved send.
- [x] Test origin/account/approval binding, malformed amounts, and accepted/rejected result delivery; review terminal approval behavior; commit and review. An initialized wallet and live payment were unavailable for the manual approval path.

### M4 Convergence

- [x] Run compile, lint, Chrome/Firefox builds, 35 focused tests, and installed-Chrome/page probes.
- [x] Update public API/operator docs with setup, privacy, supported accounts, and limits.
- [x] Repeat Astra and Codex Security review after fixes until no actionable finding remains. The final M3b security scan covered 21 changed source files with zero findings.

## Dependencies

- Compatible ZKas walletd/node and funded mainnet account for a live payment smoke test, including popup approval and history reconciliation. The pinned signer refuses testnet payments.
- Valid mainnet proof/bundle fixtures are needed to test successful pinned-WASM authorization and tampered-bundle rejection end to end; current send tests use a mock signer.
- Independent review of the upstream signer and confirmation of its redistribution license before publishing the bundled binary.
- Project targets Node 20. This host has Node 26; its Xcode license has since been accepted. A clean native `canvas` install has not been rechecked, but the existing dependencies allow type, lint, test, and build checks.
- The broader Playwright suite stalls before test discovery on this host, including when limited to an existing Kaspa batch test. The 35 focused ZKas tests completed; broader KAS/EVM regression coverage remains an external release check.
- AI DevKit task CLI returned `unknown command 'task'`; progress lives here.
- Current task branch is `kwun/zkas-support`; AI DevKit's `feature-zkas-support` branch-name lint check is expected to fail while retaining it.

## Risks & Mitigation

- Hostile or wrong daemon: check network/state and amount/fee; WASM verifies the prepared bundle.
- Viewing privacy: explicit daemon choice and no credentials in page API.
- Recovery mismatch: pinned ZIP-32 path and vectors; unsupported wallet types disabled.
- Imported-seed recovery: a Kaspa key or phrase does not recover a separately imported ZKas seed; show a distinct backup action and require the user to compare the derived address before import. Preserve reads of seeds attached by earlier builds.
- Partial send: fail before broadcast when the full amount cannot fit.
