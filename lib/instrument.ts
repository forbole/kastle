import * as Sentry from "@sentry/react";
import { isProduction } from "@/lib/utils.ts";
import { sentryScrubHooks } from "@/lib/sentry-scrub.ts";

Sentry.init({
  dsn: "https://0712497db9071d6181d6006591b352d3@o431103.ingest.us.sentry.io/4508799037472768",
  enabled: isProduction,
  // ADR-003: no env vars. The manifest version is the package.json version WXT
  // stamps at build time, read the same way getVersion.ts already does.
  release: `kastle@${browser.runtime.getManifest().version}`,
  // sendDefaultPii, beforeSend and beforeBreadcrumb. Kept in sentry-scrub.ts so
  // the canary tests can drive a real client with these exact hooks.
  ...sentryScrubHooks,
});
