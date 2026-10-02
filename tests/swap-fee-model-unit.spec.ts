import { register } from "node:module";
import { test, expect } from "@playwright/test";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export const load = (url, ctx, next) => /\\.(png|svg)$/.test(url)
        ? { format: "module", source: "export default ''", shortCircuit: true }
        : next(url, ctx);`,
    ),
);
const { computeSwapKastleFee } = await import("@/lib/swap-bridge-quote");

const base = {
  viaFeeCollector: false,
  feeBps: 0n,
  partnerFeeBps: undefined,
  amountNum: 100,
  rawIn: 100_00000000n,
  amountOut: undefined,
  tokenInDecimals: 8,
  tokenInSymbol: "KAS",
  tokenOutDecimals: 6,
  tokenOutSymbol: "USDT",
};

test("collector: fee is the cut of the input, in the input token", () => {
  const r = computeSwapKastleFee({
    ...base,
    viaFeeCollector: true,
    feeBps: 75n,
  });
  expect(r.kastleFee).toBeCloseTo(0.75, 8);
  expect(r.kastleFeeBps).toBe(75);
  expect(r.kastleFeeSymbol).toBe("KAS");
});

test("proxy: partner bps come off the quoted output, in the output token", () => {
  const r = computeSwapKastleFee({
    ...base,
    partnerFeeBps: 50,
    amountOut: 200_000000n,
  });
  expect(r.kastleFee).toBeCloseTo(1.0, 8);
  expect(r.kastleFeeBps).toBe(50);
  expect(r.kastleFeeSymbol).toBe("USDT");
});

test("neither: no collector and no partner fee is zero", () => {
  const r = computeSwapKastleFee({ ...base, amountOut: 200_000000n });
  expect(r.kastleFee).toBe(0);
  expect(r.kastleFeeBps).toBe(0);
});
