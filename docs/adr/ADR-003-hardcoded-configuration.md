# ADR-003 — Hardcoded configuration, no env vars

> **Mirror.** The source of truth is the Notion page
> [ADR-003 — Hardcoded configuration, no env vars](https://app.notion.com/p/3aa2984b7b1d81e197d7c2662c8721e3)
> (kastle Wiki / Decisions, page id `3aa2984b-7b1d-81e1-97d7-c2662c8721e3`).
> The text below is copied verbatim from that page as last edited
> 2026-07-27. Edit the Notion page first, then refresh this file.
>
> **Stale on one point (repo state 2026-09-09):** the Sources section states
> `import.meta.env` is unused. `components/screens/DevMode.tsx:133` gates the
> Sentry scrubbing check on `import.meta.env.DEV`. The ADR text is left as
> written; update Notion, not this note, when the decision is revisited.

---

*Type: Decision*
*Maintainer: Leo*
*Last updated: 2026-07-27*
*Status: Current (Accepted)*

## Sources

- [Kastle Extension Handover](https://app.notion.com/p/3a32984b7b1d80cbac11d4392161b6a8) §§2, 9
- Repo-wide verification 2026-07-27: zero `.env*` files; only `process.env.NODE_ENV` + `process.env.CI` referenced; `import.meta.env` unused

## Decision

All runtime configuration — RPC/indexer endpoints (`contexts/SettingsContext.tsx`), L2 chains (`lib/layer2.ts`), Sentry DSN (`lib/instrument.ts:5`), PostHog key (`contexts/PostHogWrapperProvider.tsx:22`), the EIP-6963 extension ID (`entrypoints/injected.ts:30`) — is hardcoded in source. The only "environment" split is `NODE_ENV` (prod gates Sentry).

## Consequences

- Rotating the Sentry DSN or PostHog key, or changing any endpoint, **requires a code change + release + store review**. Plan rotation lead time accordingly.
- Telemetry keys are cleartext in a public repo — accepted; they are client-side-public by nature. NEVER add actual secrets to source under this pattern.
- CI-only env surface: the four `CHROME_*` store-submission secrets + `APP_ID`/`APP_PRIVATE_KEY`/`SLACK_WEBHOOK_URL` in GitHub Actions.
