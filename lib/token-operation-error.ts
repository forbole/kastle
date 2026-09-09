export type TokenOperationFailureKind =
  | "disconnected"
  | "commit_timeout"
  | "default";

export interface TokenOperationFailure {
  kind: TokenOperationFailureKind;
  /** Always a string: this is what the fail screen renders. */
  message: string;
}

// The mint/deploy screens navigate to the fail screen with whatever
// `CommitRevealHelper.perform` rejected with. The Generator and the RPC reject
// with strings, the helper with Error objects; React cannot render an Error
// (error #31), so everything is reduced to a string before it reaches JSX.
export const describeTokenOperationError = (
  error: unknown,
): TokenOperationFailure => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "Unknown error");

  if (message.includes("disconnected")) {
    return { kind: "disconnected", message };
  }
  // waitTxForAddress rejects with "Timeout"; on the commit leg that is the
  // only timeout perform() still throws (a reveal confirmation timeout is
  // caught and warned in lib/commit-reveal.ts, so there is no reveal kind).
  if (
    message === "Timeout" ||
    message === "Commit transaction did not mature within 2 minutes"
  ) {
    return { kind: "commit_timeout", message };
  }

  return { kind: "default", message };
};
