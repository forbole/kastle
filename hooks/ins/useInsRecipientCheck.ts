import { useEffect, useRef, useState } from "react";
import { lookupInsNameOnChain, toInsLabel } from "@/lib/ins/insRegistry";

// How long an address resolved on the Details step stays usable. Past it the
// user goes back, and the Details step resolves the name again.
export const INS_RESOLUTION_TTL_MS = 60_000;

/** The send form fields that carry a name-resolved recipient. */
export interface InsRecipient {
  userInput?: string;
  address?: string;
  domain?: string;
  /** toInsLabel of the input that `address` was resolved from. */
  resolvedFor?: string;
  /** Date.now() when `address` was resolved. */
  resolvedAt?: number;
}

export type InsRecipientCheck = {
  status: "checking" | "verified" | "blocked";
  message: string;
};

async function recipientError(
  chainId: `0x${string}`,
  domain: string,
  { userInput, address, resolvedFor, resolvedAt }: InsRecipient,
): Promise<string | undefined> {
  if (
    !address ||
    resolvedAt === undefined ||
    resolvedFor !== toInsLabel(domain) ||
    resolvedFor !== toInsLabel(userInput ?? "")
  ) {
    return "The recipient changed. Go back and check it again.";
  }

  if (Date.now() - resolvedAt > INS_RESOLUTION_TTL_MS) {
    return "This name was checked over a minute ago. Go back to check it again.";
  }

  // Never falls back to the stored address: no fresh answer, no send.
  const onChain = await lookupInsNameOnChain(domain, chainId);
  if (!onChain.ok) return onChain.reason;

  if (onChain.address.toLowerCase() !== address.toLowerCase()) {
    return "This name now points to a different address. Go back and check the recipient.";
  }

  return undefined;
}

/**
 * Re-verifies a name-resolved recipient on the Confirm step: once on mount, so
 * a mismatch shows before the user signs, and again through `verify` right
 * before signing, because the screen can stay open past a re-point.
 *
 * `check` stays undefined for a pasted address -- there is no name to re-check.
 */
export default function useInsRecipientCheck(
  chainId: `0x${string}`,
  recipient: InsRecipient,
) {
  const [check, setCheck] = useState<InsRecipientCheck>();
  // Only the latest run may set `check`, so a slow mount check cannot paint
  // "verified" over a newer blocked result.
  const seq = useRef(0);

  const verify = async (): Promise<boolean> => {
    const { domain } = recipient;
    if (!domain) return true;

    const run = ++seq.current;
    setCheck({ status: "checking", message: "Checking this name on-chain…" });
    const reason = await recipientError(chainId, domain, recipient);
    if (run === seq.current) {
      setCheck(
        reason
          ? { status: "blocked", message: reason }
          : { status: "verified", message: "Verified on-chain owner" },
      );
    }
    return !reason;
  };

  useEffect(() => {
    void verify();
  }, []);

  return { check, verify };
}
