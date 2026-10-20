import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";

registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const {
  KASTLE_SWAP_FEE_BPS,
  bridgeReceived,
  l1BridgeSplit,
  swapMinReceived,
  swapPathAmountIn,
} = await import("@/lib/swap-bridge-quote");

test("the fee collector's rate comes off the routed amount only", () => {
  expect(String(swapPathAmountIn(10_000n, KASTLE_SWAP_FEE_BPS))).toBe("9925");
  expect(String(swapPathAmountIn(10_000n, 30n))).toBe("9970");
  expect(String(swapPathAmountIn(10_000n, 0n))).toBe("10000");
});

test("min received matches the executor's slippage floor", () => {
  expect(String(swapMinReceived(1_000_000n, 0.5))).toBe("995000");
  expect(String(swapMinReceived(1_000_000n, 2))).toBe("980000");
});

test("L1 bridge pays 0.2 KAS + 0.75% to Kastle and the rest to the entry", () => {
  const { kastleFee, entry } = l1BridgeSplit(100);
  expect(kastleFee).toBeCloseTo(0.95, 10);
  expect(entry).toBeCloseTo(99.05, 10);
});

test("received per direction", () => {
  // Kurve takes its 0.5 KAS upstream.
  expect(bridgeReceived("kas-kasplex", 100)).toBeCloseTo(98.55, 10);
  expect(bridgeReceived("kasplex-kas", 100)).toBeCloseTo(99.5, 10);
});
