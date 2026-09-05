import * as Sentry from "@sentry/react";
import { isProduction } from "@/lib/utils.ts";
import { sentryScrubHooks } from "@/lib/sentry-scrub.ts";

const manifest = browser.runtime.getManifest();

Sentry.init({
  dsn: "https://0712497db9071d6181d6006591b352d3@o431103.ingest.us.sentry.io/4508799037472768",
  enabled: isProduction,
  // ADR-003: no env vars. WXT stamps the package.json version into the
  // manifest; a prerelease suffix (2.59.6-s1-qa-56f8264) is not a valid
  // `version`, so it survives only in `version_name`. QA builds must not report
  // as the release they were cut from.
  release: `kastle@${manifest.version_name ?? manifest.version}`,
  // sendDefaultPii, beforeSend and beforeBreadcrumb. Kept in sentry-scrub.ts so
  // the canary tests can drive a real client with these exact hooks.
  ...sentryScrubHooks,
});
