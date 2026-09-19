---
phase: requirements
title: ZKas support
description: Shielded ZKas accounts and payments in Kastle
---

# ZKas support

## Problem Statement

Kastle handles Kaspa transparent accounts and transfers. ZKas is a separate mandatory-shielded chain, so its addresses, balance, proofs, and payment signatures require a separate flow. Users need familiar asset, receive, send, and dApp workflows without giving a service their spending key.

## Goals & Objectives

- Derive ZKas accounts for eligible recovery-phrase accounts with the upstream ZIP-32 account path. Keep the phrase and derived spending seed inside the extension.
- Add ZKAS asset, receive, balance/sync, and send screens with details → confirm → result; show fees and incomplete-history warnings.
- Use a user-selected wallet daemon for scanning and proof generation. Register only a full viewing key; verify and sign on the device.
- Provide connected-origin dApp read methods and a fresh payment approval. Provide a standalone localhost extension test page.
- Preserve KAS and EVM behavior.
- Non-goals: custodial daemon endpoints, local Halo 2 proving, Ledger ZKas signing, automatic multi-transaction payments.

## User Stories & Use Cases

- A phrase-backed user selects ZKAS, sees a shielded address and sync state, and copies it.
- The user enters a ZKas address and exact amount, sees a fee ceiling, confirms, then sees the txid or a clear failure with no partial payment.
- A connected dApp reads the selected shielded address/balance and requests a payment that gets its own visible confirmation.
- A developer opens a localhost page and probes an installed Kastle extension without receiving keys or viewing credentials.
- Ledger, private-key, and passphrase-backed accounts see an unsupported state.

## Success Criteria

- Every spend uses upstream `verify_and_sign_payment` with exact recipient, amount, and maximum fee. No product path uses blind signing.
- No phrase, spending seed, FVK, or wallet token crosses the page bridge.
- Wrong-network, unsynced, incomplete-history, malformed, changed-amount, and over-fee responses fail closed.
- New security-boundary tests and existing relevant regressions pass; compile, lint, and extension build results are recorded.
- Local page works with an installed development extension. Live send validation needs a compatible mainnet daemon and funded account. Testnet send needs a signer that pins the testnet genesis; the current signer does not.

## Constraints & Assumptions

- ZKas mainnet/testnet are distinct from Kaspa mainnet/testnet-10.
- Pin `firecash/zkas-signer` source `44209c7f9b7ada554a40b633a8025888f625418f` and the reference binary from `firecash/zkas-wallet` `ae576a86a47df0e52ab0fdf7f1103ba818b09609` (SHA-256 `ea0ec55a2cef0bb7f3cd6ce80b0e5c218693e0e97be49c80a73587b1eefcd409`). Check the genesis domain before release.
- `@zkas/sdk` returned npm 404 on 2026-09-19; implement a narrow, typed daemon adapter based on upstream source.
- Named assumptions pending user reply: existing ordinary BIP39 phrase derives ZKas; user configures a daemon rather than silently using a hosted operator.
- Upstream says its novel shielded consensus code has no independent audit. Kastle integration review is not a consensus audit.

## Questions & Open Items

- Confirm same phrase versus separate ZKas phrase and daemon default.
- Obtain a compatible mainnet daemon and funded account for live payment validation, and a reviewed testnet signer before testnet payment testing.
- Upstream signer needs a reviewed passphrase API and hardware signing before those account types are enabled.
