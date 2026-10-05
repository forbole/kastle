import { register } from "node:module";
import { test, expect } from "@playwright/test";
import { curve } from "@kronsdk/kron-sdk";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export const load = (url, ctx, next) => /\\.(png|svg)$/.test(url)
        ? { format: "module", source: "export default ''", shortCircuit: true }
        : next(url, ctx);`,
    ),
);
const {
  KronSwapError,
  kronErrorCopy,
  kronKastleFee,
  kronKastleFeeBps,
  quoteKron,
} = await import("@/lib/kcc20/swap");
const { Kcc20TransferError } = await import("@/lib/kcc20/transfer");

const KAS = 100_000_000n;

const state: curve.CpState = {
  realKas: 50_000n * KAS,
  tokenReserve: 800_000_000n * KAS,
  vKas: 30_000n * KAS,
  graduationKas: 1_000_000n * KAS,
  creatorFeeBps: 50n,
  platformFeeBps: 50n,
  devFundBps: 0n,
};

test("Kastle fee is 0.75% of the KAS leg, floored at the 0.2 KAS output minimum", () => {
  expect(String(kronKastleFee(1000n * KAS))).toBe(String((75n * KAS) / 10n));
  expect(String(kronKastleFee(10n * KAS))).toBe(String(curve.FEE_OUT_MIN));
});

test("buy: the Kastle fee comes off the KAS in, the rest goes to the curve", () => {
  const q = quoteKron(state, "buy", 1000n * KAS)!;
  const fee = kronKastleFee(1000n * KAS);
  const cp = curve.quoteCpBuy(state, 1000n * KAS - fee)!;
  expect(String(q.kastleFee)).toBe(String(fee));
  expect(String(q.curveKas)).toBe(String(cp.kasIn));
  expect(String(q.amountOut)).toBe(String(cp.tokenOut));
  expect(String(q.curveFee)).toBe(String(cp.fee));
  expect(kronKastleFeeBps(q)).toBe(75);
});

test("sell: the Kastle fee comes off the curve's net KAS out", () => {
  const tokens = 1_000_000n * KAS;
  const q = quoteKron(state, "sell", tokens)!;
  const cp = curve.quoteCpSell(state, tokens)!;
  expect(String(q.kastleFee)).toBe(String(kronKastleFee(cp.net)));
  expect(String(q.amountOut + q.kastleFee)).toBe(String(cp.net));
  expect(String(q.curveKas)).toBe(String(cp.kasOut));
});

test("the 0.2 KAS floor shows as its effective rate; dust trades do not quote", () => {
  const q = quoteKron(state, "buy", 10n * KAS)!;
  expect(String(q.kastleFee)).toBe(String(curve.FEE_OUT_MIN));
  expect(kronKastleFeeBps(q)).toBe(200);
  expect(quoteKron(state, "buy", curve.FEE_OUT_MIN)).toBeUndefined();
});

test("swap errors map to user copy, never the raw throw", () => {
  const fallback = "Swap failed. Please try again.";
  for (const code of [
    "too-small",
    "price-moved",
    "graduated",
    "curve-busy",
    "unverified",
  ] as const) {
    const copy = kronErrorCopy(new KronSwapError(code, "raw"), fallback);
    expect(copy).not.toBe("raw");
    expect(copy).not.toBe(fallback);
  }
  expect(
    kronErrorCopy(new Kcc20TransferError("fragmented", "split"), fallback),
  ).toBe("split");
  expect(kronErrorCopy(new Error("rpc down"), fallback)).toBe(fallback);
});
