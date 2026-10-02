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
  feeBps: 75n,
  amountNum: 100,
  rawIn: 100_00000000n,
  outNum: 200,
  tokenInDecimals: 8,
  tokenInSymbol: "KAS",
  tokenOutSymbol: "USDT",
};

test("fee collector takes 0.75% of the input token", () => {
  const r = computeSwapKastleFee({ ...base, viaFeeCollector: true });
  expect(r.kastleFee).toBeCloseTo(0.75, 8);
  expect(r.kastleFeeBps).toBe(75);
  expect(r.kastleFeeSymbol).toBe("KAS");
});

test("proxy partner fee is taken from the output token", () => {
  const r = computeSwapKastleFee({
    ...base,
    viaFeeCollector: false,
    partnerFeeBps: 50,
  });
  expect(r.kastleFee).toBeCloseTo(1.0, 10);
  expect(r.kastleFeeBps).toBe(50);
  expect(r.kastleFeeSymbol).toBe("USDT");
});

test("no collector and no partner fee means no Kastle fee", () => {
  const r = computeSwapKastleFee({
    ...base,
    viaFeeCollector: false,
    partnerFeeBps: undefined,
  });
  expect(r.kastleFee).toBe(0);
  expect(r.kastleFeeBps).toBe(0);
});
