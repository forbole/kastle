import * as Sentry from "@sentry/react";
import { isProduction } from "@/lib/utils.ts";

Sentry.init({
  dsn: "https://0712497db9071d6181d6006591b352d3@o431103.ingest.us.sentry.io/4508799037472768",
  enabled: isProduction,
});
