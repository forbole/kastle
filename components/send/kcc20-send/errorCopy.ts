import { Kcc20TransferError } from "@/lib/kcc20/transfer";
import { Kcc20StandardBuildError } from "@/lib/kcc20/standard/build-transfer";

const UNSUPPORTED_SCHEMA_COPY =
  "This token uses the KCC-20 standard, which this version cannot send yet.";

// Legacy codes whose builder message is not the copy the user should read.
const LEGACY_COPY: Partial<Record<Kcc20TransferError["code"], string>> = {
  "unsupported-schema": UNSUPPORTED_SCHEMA_COPY,
};

// Every standard code, so a new one fails to compile until it has copy.
const STANDARD_COPY: Record<Kcc20StandardBuildError["code"], string> = {
  "invalid-amount": "Enter an amount greater than zero.",
  "insufficient-balance":
    "You don't have enough spendable balance of this token for this amount.",
  fragmented:
    "Your balance is split across too many pieces to send this amount at once. Try a smaller amount.",
  "not-standard": "This token's contract is not one this wallet can send.",
  "not-owned": "This wallet cannot sign for the pieces of this token.",
  "unsupported-template":
    "Part of this token uses a contract version this wallet cannot send yet. Nothing was sent.",
  "mixed-template":
    "Your pieces of this token use different contract versions and cannot be sent together. Try a smaller amount.",
  "rule-violation":
    "This transfer breaks the token's rules, so it was stopped before signing. Nothing was sent.",
  layout:
    "The wallet could not build a valid transfer for this token. Nothing was sent.",
  "bad-signature":
    "The transfer signature could not be verified, so it was not sent.",
};

/** The sentence the send screen shows for a failed build; legacy copy is unchanged. */
export function kcc20BuildErrorCopy(e: unknown): string {
  if (e instanceof Kcc20TransferError) return LEGACY_COPY[e.code] ?? e.message;
  if (e instanceof Kcc20StandardBuildError) return STANDARD_COPY[e.code];
  return "Could not build the transfer";
}

/** A failed send: standard codes get their copy, anything else keeps its message. */
export function kcc20SendErrorCopy(e: unknown): string {
  if (e instanceof Kcc20StandardBuildError) return STANDARD_COPY[e.code];
  return e instanceof Error ? e.message : "Transfer failed";
}
