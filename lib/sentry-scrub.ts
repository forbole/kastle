import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/react";
import { english } from "viem/accounts";

/**
 * Redaction for Sentry payloads.
 *
 * The popup holds raw recovery phrases and private keys in React state
 * (`ShowWalletSecret`, the import flows). Sentry's default browser integrations
 * capture console arguments as breadcrumbs and unhandled errors via
 * `globalHandlers`, so any secret that reaches a log line or an error message
 * would leave the device automatically. Everything sent to Sentry passes
 * through here first.
 *
 * Pure and Sentry-independent so it can be unit tested directly.
 */

export const REDACTED = "[REDACTED]";

/** A BIP-39 phrase is 12/15/18/21/24 words; 12 is the shortest that exists. */
const MIN_MNEMONIC_WORDS = 12;

const BIP39_WORDS = new Set(english);

/** Keys whose value is redacted whatever it looks like. */
const SECRET_KEY_PATTERN =
  /seed|mnemonic|privatekey|phrase|passphrase|password|secret|xprv/i;

/** 32-byte hex — secp256k1 / Kaspa private keys, with or without `0x`. */
const HEX_KEY_PATTERN = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;

/** BIP-32 extended private keys (`xprv…`) and their Kaspa variant (`kprv…`). */
const EXTENDED_KEY_PATTERN = /\b[xk]prv[0-9A-Za-z]{20,}\b/g;

const WORD_PATTERN = /[A-Za-z]+/g;

/**
 * Replace every run of >= MIN_MNEMONIC_WORDS consecutive BIP-39 dictionary
 * words. Separators between words are not inspected, so a phrase pasted with
 * commas, newlines or numbering is still caught.
 */
export function redactMnemonics(text: string): string {
  const words = [...text.matchAll(WORD_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    inDictionary: BIP39_WORDS.has(match[0].toLowerCase()),
  }));

  const spans: Array<[number, number]> = [];
  for (let i = 0; i < words.length; i++) {
    if (!words[i].inDictionary) continue;
    let last = i;
    while (last + 1 < words.length && words[last + 1].inDictionary) last++;
    if (last - i + 1 >= MIN_MNEMONIC_WORDS) {
      spans.push([words[i].start, words[last].end]);
    }
    i = last;
  }
  if (spans.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    result += text.slice(cursor, start) + REDACTED;
    cursor = end;
  }
  return result + text.slice(cursor);
}

export function redactString(text: string): string {
  return redactMnemonics(
    text
      .replace(HEX_KEY_PATTERN, REDACTED)
      .replace(EXTENDED_KEY_PATTERN, REDACTED),
  );
}

function scrub(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;

  // ponytail: cycles are dropped rather than tracked per-path; Sentry payloads
  // are trees, so a repeat means a cycle in practice.
  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => scrub(item, seen));

  const entries = Object.entries(value);
  // Errors, Dates and other exotic objects expose no enumerable own keys.
  // Rebuilding them would throw the payload away, so hand them back untouched —
  // Sentry serialises those itself before they reach the wire.
  if (entries.length === 0) return value;

  const scrubbed: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    scrubbed[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : scrub(item, seen);
  }
  return scrubbed;
}

/**
 * Recursively redact an arbitrary Sentry payload (event or breadcrumb).
 *
 * Fails closed: if redaction throws for any reason the caller must drop the
 * payload rather than send it unscrubbed.
 */
export function scrubPayload<T>(payload: T): T | null {
  try {
    return scrub(payload, new WeakSet()) as T;
  } catch {
    return null;
  }
}

/**
 * The privacy half of `Sentry.init`, kept here rather than inline in
 * lib/instrument.ts so tests can drive a real Sentry client with the exact
 * hooks production uses. instrument.ts spreads this object; importing it from
 * there instead would drag the whole app asset graph into the test runner.
 *
 * The Sentry import above is type-only and erases at compile time, so this
 * module stays runtime-independent of the SDK.
 */
export const sentryScrubHooks = {
  // Never rely on the SDK's default here — the popup holds recovery phrases and
  // private keys in memory.
  sendDefaultPii: false,
  // Console breadcrumbs and `globalHandlers` are on by default, so both the
  // event and every breadcrumb are redacted before they leave the device.
  // `scrubPayload` returns null on failure, which drops the payload.
  beforeSend: (event: ErrorEvent) => scrubPayload(event),
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrubPayload(breadcrumb),
} satisfies Pick<
  BrowserOptions,
  "sendDefaultPii" | "beforeSend" | "beforeBreadcrumb"
>;
