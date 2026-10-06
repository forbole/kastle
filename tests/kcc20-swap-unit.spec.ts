import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { curve, curveCp, kcc20 } from "@kronsdk/kron-sdk";
import { hexToBytes } from "viem";
import * as kaspa from "@/wasm/core/kaspa";

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
const { Kcc20TransferError, fundCovenantSpend } = await import(
  "@/lib/kcc20/transfer"
);

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
  // 0.3 KAS: the 0.2 KAS fee floor would exceed the ~0.1 KAS curve leg.
  expect(quoteKron(state, "buy", (3n * KAS) / 10n)).toBeUndefined();
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

test.describe("recipient-bound curve schema", () => {
  const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
  const COVID = hexToBytes(`0x${"cd".repeat(32)}`);
  const RESERVE = 800_000_000n * KAS;
  let address: string;
  let xonly: Uint8Array;
  const k = kaspa as unknown as Parameters<typeof curveCp.buildCpBuy>[0];
  let cpTpl: Parameters<typeof curveCp.buildCpBuy>[1];
  let tokenTpl: kcc20.Kcc20Template;

  test.beforeAll(async () => {
    await kaspa.default({
      module_or_path: fs.readFileSync(
        path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
      ),
    });
    const key = new kaspa.PrivateKey("1".repeat(64));
    address = key.toAddress("mainnet").toString();
    xonly = hexToBytes(`0x${key.toPublicKey().toXOnlyPublicKey().toString()}`);
    // State regions only; the builders never execute the scripts.
    // curve: push1 graduated / push32 tokenCovid / push8 tokenReserve.
    cpTpl = {
      script: new Uint8Array([
        0x51,
        ...[0x01, 0x00, 0x20, ...new Array(32).fill(0)],
        ...[0x08, ...new Array(8).fill(0)],
        0x51,
      ]),
      stateStart: 1,
      params: {
        creatorFeeOwner: xonly,
        platformFeeOwner: xonly,
        vKas: state.vKas,
        graduationKas: state.graduationKas,
        creatorFeeBps: 50n,
        platformFeeBps: 50n,
        graduationFeeBps: 0n,
      },
      recipientBound: true,
    };
    // token: push32 owner / push1 type / push8 amount / push1 isMinter.
    tokenTpl = {
      script: new Uint8Array([
        0x51,
        ...[0x20, ...new Array(32).fill(0), 0x01, kcc20.IDENTIFIER.ADDRESS],
        ...[0x08, ...new Array(8).fill(0), 0x01, 0x00],
        0x51,
      ]),
      stateStart: 1,
      maxIns: 4,
      maxOuts: 4,
    };
  });

  const outpoint = (n: number) => ({
    transactionId: n.toString(16).padStart(64, "0"),
    index: 0,
  });
  const utxo = () => ({
    ...outpoint(1),
    realKas: state.realKas,
    state: { graduated: false, tokenCovid: COVID, tokenReserve: RESERVE },
  });
  const inventory = () => ({
    ...outpoint(2),
    value: 50_000_000n,
    amount: RESERVE,
  });
  const fund = (s: ReturnType<typeof curveCp.buildCpBuy>) =>
    fundCovenantSpend({
      spend: s,
      funding: [
        {
          entry: {},
          address,
          outpoint: { transactionId: "ee".repeat(32), index: 0 },
          amount: 10_000n * KAS,
          scriptPublicKey: kaspa.payToAddressScript(address),
          blockDaaScore: 0n,
          isCoinbase: false,
        },
      ] as unknown as Parameters<typeof fundCovenantSpend>[0]["funding"],
      address,
    });

  test("buy binds to the first funding input, after curve + inventory", () => {
    const s = curveCp.buildCpBuy(
      k,
      cpTpl,
      tokenTpl,
      utxo(),
      inventory(),
      COVID,
      xonly,
      1000n * KAS,
      KAS,
      [],
      2,
    );
    expect(fund(s).fundingInputIndexes[0]).toBe(2);
  });

  test("sell binds to the first funding input, after the seller pieces", () => {
    const pieces = [10n, 20n].map((n, i) => ({
      ...outpoint(3 + i),
      value: 50_000_000n,
      state: kcc20.addressPresenceOwned(xonly, n * KAS),
    }));
    const s = curveCp.buildCpSell(
      k,
      cpTpl,
      tokenTpl,
      utxo(),
      pieces,
      inventory(),
      COVID,
      xonly,
      30n * KAS,
      100n * KAS,
      2 + pieces.length,
    );
    expect(fund(s).fundingInputIndexes[0]).toBe(2 + pieces.length);
  });
});
