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
  /seed|mnemonic|privatekey|phrase|passphrase|password|secret|[xk]prv/i;

/**
 * Separators are stripped before the key is tested, so `private_key`,
 * `private-key` and `private key` all reduce to `privatekey`. Without this only
 * the camelCase spelling matched, and `secret_key` passed by accident because
 * `secret` happens to be an alternative of its own.
 */
const isSecretKey = (key: string) =>
  SECRET_KEY_PATTERN.test(key.replace(/[^A-Za-z0-9]/g, ""));

/**
 * Any hex run long enough to contain a 32-byte key — secp256k1 / Kaspa private
 * keys, with or without `0x`.
 *
 * Deliberately not `\b`-anchored: `\b` needs a non-word character on each side,
 * so `key${hex}` — plain string concatenation, which is exactly how a key ends
 * up in a log line — would not match. The lookarounds reject only adjacent *hex*
 * characters, so the match still stops at the end of the run.
 *
 * `{64,}` rather than `{64}`: two concatenated keys are 128 characters and an
 * exact-length pattern skips them entirely. Redacting the whole run costs
 * serialised transactions and signatures in crash reports, which is the cheaper
 * side of the trade — a 32-byte hash is indistinguishable from a 32-byte key, so
 * every txid and block hash was already being redacted at exactly 64.
 */
const HEX_KEY_PATTERN =
  /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64,}(?![0-9a-fA-F])/g;

/**
 * BIP-32 extended private keys (`xprv…`) and their Kaspa variant (`kprv…`).
 *
 * Unanchored for the same reason. A leading lookbehind cannot help here: the key
 * body is alphanumeric, so "not preceded by an alphanumeric" would reject
 * `seed${xprv}` too. Over-matching is the safe direction — a word that happens
 * to contain `xprv` followed by 20+ alphanumerics is not a real string.
 */
const EXTENDED_KEY_PATTERN = /[xk]prv[0-9A-Za-z]{20,}/g;

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
    scrubbed[key] = isSecretKey(key) ? REDACTED : scrub(item, seen);
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
