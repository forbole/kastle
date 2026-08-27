import * as Sentry from "@sentry/react";
import { isProduction } from "@/lib/utils.ts";
import { scrubPayload } from "@/lib/sentry-scrub.ts";

Sentry.init({
  dsn: "https://0712497db9071d6181d6006591b352d3@o431103.ingest.us.sentry.io/4508799037472768",
  enabled: isProduction,
  // Never rely on the SDK's default here — the popup holds recovery phrases and
  // private keys in memory.
  sendDefaultPii: false,
  // Console breadcrumbs and `globalHandlers` are on by default, so both the
  // event and every breadcrumb are redacted before they leave the device.
  // `scrubPayload` returns null on failure, which drops the payload.
  beforeSend: (event) => scrubPayload(event),
  beforeBreadcrumb: (breadcrumb) => scrubPayload(breadcrumb),
});
