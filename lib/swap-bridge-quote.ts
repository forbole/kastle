// Quote math for the swap and bridge screens. Pure so the unit spec can
// import it; the executors re-derive the amounts they sign on their own.
import { formatUnits } from "viem";
import {
  BridgeDirection,
  KASPLEX_EXIT_FEE_RATE,
  KURVE_SERVICE_FEE,
  kastleL1BridgeFee,
} from "@/lib/bridge/bridge";

// FeeCollectorSwapExecutor's fallback when feeRate() cannot be read.
export const KASTLE_SWAP_FEE_BPS = 75n;

/** What the router receives after the fee collector's feeBps cut (0n direct). */
export const swapPathAmountIn = (raw: bigint, feeBps: bigint) =>
  (raw * (10_000n - feeBps)) / 10_000n;

/**
 * Kastle's swap cut: input token via a fee collector, else the output token
 * through the proxy's partner fee (0 when neither applies).
 */
export function computeSwapKastleFee(args: {
  viaFeeCollector: boolean;
  feeBps: bigint;
  partnerFeeBps?: number;
  amountNum: number;
  rawIn: bigint;
  outNum?: number;
  tokenInDecimals: number;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
}) {
  const kastleFeeBps = args.viaFeeCollector
    ? Number(args.feeBps)
    : (args.partnerFeeBps ?? 0);
  const kastleFeeSymbol = args.viaFeeCollector
    ? args.tokenInSymbol
    : args.tokenOutSymbol;
  const kastleFee = args.viaFeeCollector
    ? args.amountNum -
      Number(
        formatUnits(
          swapPathAmountIn(args.rawIn, args.feeBps),
          args.tokenInDecimals,
        ),
      )
    : kastleFeeBps > 0 && args.outNum !== undefined
      ? args.outNum * (kastleFeeBps / 10000)
      : 0;
  return { kastleFeeBps, kastleFeeSymbol, kastleFee };
}

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
