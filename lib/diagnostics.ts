import { redactString, scrubPayload } from "@/lib/sentry-scrub";

/**
 * 64-hex runs (txids, keys) via the Sentry redactor, then addresses: Kaspa,
 * and the 0x + 40-hex EVM ones viem errors carry as sender and recipient
 * (glued to a word too: over-matching is the safe direction).
 */
export const scrubReportText = (text: string) =>
  redactString(text)
    .replace(/kaspa(?:test|dev|sim)?:[a-z0-9]+/g, "[ADDRESS]")
    .replace(/0x[0-9a-f]{40}(?![0-9a-f])/gi, "[ADDRESS]");

/** Scrubbed, then cut: a cut 64-hex run would slip past the redactor. */
export const reportError = (error: unknown) =>
  scrubReportText(String(error)).slice(0, 300);

/**
 * What the failure screen's "Copy report" hands the user to send us: counts,
 * versions and the node's reason. No address, outpoint or txid: every string
 * field is scrubbed.
 */
export function buildRoundReport<
  T extends Record<string, string | number | boolean | undefined>,
>(fields: T): T & { timestamp: string } {
  return {
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === "string" ? scrubReportText(value) : value,
      ]),
    ),
    timestamp: new Date().toISOString(),
  } as T & { timestamp: string };
}

type DiagnosticField = string | number | boolean | undefined;

export type DiagnosticReport = Record<string, DiagnosticField> & {
  flow: string;
  error: string;
  cause?: string;
  timestamp: string;
};

/** Per string value; long enough for a node reason plus its cause. */
const MAX_DIAGNOSTIC_TEXT = 1000;

/** String() → scrub → cut. Throws when the scrubber hands back a non-string. */
function clip(value: unknown): string {
  const scrubbed: unknown = scrubReportText(String(value));
  if (typeof scrubbed !== "string") {
    throw new TypeError("scrubReportText returned a non-string");
  }
  return scrubbed.slice(0, MAX_DIAGNOSTIC_TEXT);
}

/**
 * The one entry point for every flow's "Copy logs": the raw error, then its
 * `.cause`, then the caller's fields, each string scrubbed before it is cut.
 * A field whose name looks secret (password, seed, private key…) is redacted
 * whatever its value, by the same name policy Sentry payloads get.
 *
 * Returns `null` when any step throws (a hostile `toString`, a throwing
 * `.cause` getter, a broken scrubber) so the caller renders no copy control —
 * never a raw, unscrubbed string. Caller fields cannot replace flow, error or
 * cause. Fields read off the error (a viem `walk` for the RPC code) go in as a
 * function, so a getter that throws there is caught here too.
 */
export function buildDiagnosticReport(
  flow: string,
  error: unknown,
  fields:
    | Record<string, DiagnosticField>
    | (() => Record<string, DiagnosticField>) = {},
): DiagnosticReport | null {
  try {
    const report: Record<string, DiagnosticField> = {
      flow: clip(flow),
      error: clip(error),
    };
    const cause = (error as { cause?: unknown } | null | undefined)?.cause;
    if (cause !== undefined) report.cause = clip(cause);
    const named = scrubPayload(
      typeof fields === "function" ? fields() : fields,
    );
    if (!named) return null;
    for (const [key, value] of Object.entries(named)) {
      if (key in report) continue;
      report[key] = typeof value === "string" ? clip(value) : value;
    }
    report.timestamp = new Date().toISOString();
    return report as DiagnosticReport;
  } catch {
    return null;
  }
}
