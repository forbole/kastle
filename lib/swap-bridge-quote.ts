// Quote math for the swap and bridge screens. Pure so the unit spec can
// import it; the executors re-derive the amounts they sign on their own.
import {
  BridgeDirection,
  KASPLEX_EXIT_FEE_RATE,
  KURVE_SERVICE_FEE,
  kastleL1BridgeFee,
} from "@/lib/bridge/bridge";

// FeeCollectorSwapExecutor's fallback when feeRate() cannot be read.
export const KASTLE_SWAP_FEE_BPS = 75n;

/** What the router receives: fee-collector swaps lose the Kastle cut first. */
export const swapPathAmountIn = (raw: bigint, viaFeeCollector: boolean) =>
  viaFeeCollector ? (raw * (10_000n - KASTLE_SWAP_FEE_BPS)) / 10_000n : raw;

/** Same formula as BaseSwapExecutor.calculateMinAmount. */
export const swapMinReceived = (amountOut: bigint, slippagePercent: number) =>
  (amountOut * BigInt(Math.floor((100 - slippagePercent) * 100))) / 10_000n;

/** L1 → L2 split: what the entry address gets and the Kastle fee output. */
export const l1BridgeSplit = (amount: number) => {
  const kastleFee = kastleL1BridgeFee(amount);
  return { kastleFee, entry: amount - kastleFee };
};

/**
 * Estimated amount on the destination chain. igra-kas needs the on-chain
 * upstream fee, so the caller passes it (KAS) once read.
 */
export function bridgeReceived(
  direction: BridgeDirection,
  amount: number,
  igraExit?: { feeRateBps: number; upstreamFeeKas: number },
): number | undefined {
  switch (direction) {
    case "kas-igra":
      return l1BridgeSplit(amount).entry;
    case "kas-kasplex":
      return l1BridgeSplit(amount).entry - KURVE_SERVICE_FEE;
    case "kasplex-kas":
      return amount * (1 - KASPLEX_EXIT_FEE_RATE);
    case "igra-kas":
      if (!igraExit) return undefined;
      return (
        amount * (1 - igraExit.feeRateBps / 10_000) - igraExit.upstreamFeeKas
      );
  }
}
