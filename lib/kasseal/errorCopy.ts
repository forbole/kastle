import { errorCode } from "@kassealhq/sdk";
import { KassealTradeError, KassealTradeErrorCode } from "./trade";
import { KassealReloadRequired } from "./init";

const TRADE_COPY: Record<KassealTradeErrorCode, string> = {
  "proof-not-bound":
    "This token's launch could not be verified, so the wallet will not trade it.",
  "wrong-token":
    "The launch record does not match this token, so the wallet will not trade it.",
  "no-pool": "This token has no verified pool to trade against yet.",
  "invalid-amount": "Enter a larger amount.",
  "outcome-unknown":
    "Your trade may still go through. Trying again checks it first and reuses the same coins, so it cannot pay twice.",
};

// SDK error codes the user can act on; anything else keeps a generic line.
const SDK_COPY: Record<string, string> = {
  CURVE_NOT_OF_PROOF:
    "The curve does not match this token's verified launch. Nothing was sent.",
  POOL_NOT_OF_PROOF:
    "The pool does not match this token's verified launch. Nothing was sent.",
  LINEAGE_MISMATCH:
    "The token on chain does not match its verified launch. Nothing was sent.",
  PROOF_NOT_BOUND:
    "This token's launch could not be verified, so the wallet will not trade it.",
  INSUFFICIENT_FUNDS: "You don't have enough KAS for this trade and its fee.",
  INSUFFICIENT_TOKENS: "You don't have enough of this token for this amount.",
  NET_BOUND_EXCEEDED:
    "The price moved past your slippage limit. Nothing was sent.",
  SLIPPAGE_OUT_OF_RANGE: "Slippage must be between 0% and 10%.",
  HEAD_MOVING: "The market is busy. Try again in a moment.",
  PINNED_FUNDING_GONE:
    "Your earlier attempt may have gone through. Check your activity before trying again.",
  NEEDS_CONSOLIDATION:
    "Your balance is split across too many pieces for this trade. Try a smaller amount.",
  SDK_INTEGRITY: "The trading module failed its integrity check.",
  SDK_INCOMPATIBLE: "The trading module failed its integrity check.",
};

export function kassealErrorCopy(e: unknown): string {
  if (e instanceof KassealTradeError) return TRADE_COPY[e.code];
  if (e instanceof KassealReloadRequired)
    return "Close and reopen the wallet to trade on this network.";
  const code = errorCode(e);
  if (code && SDK_COPY[code]) return SDK_COPY[code];
  return "Something went wrong. Nothing was sent.";
}
