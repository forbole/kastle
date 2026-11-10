import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";
import type { KaspaTxHistoryItem } from "@/hooks/useKasTxHistory";

// The adapter reaches the Settings screen (explorer links), which imports
// logos and package.json; stub images as their path and load JSON as JSON.
registerHooks({
  load(url, context, next) {
    if (url.endsWith(".json"))
      return next(url, { ...context, importAttributes: { type: "json" } });
    if (!/\.(svg|png)$/.test(url)) return next(url, context);
    return {
      format: "commonjs",
      source: `module.exports = ${JSON.stringify(url)};`,
      shortCircuit: true,
    };
  },
});

const { toHistoryRecord } = await import("@/lib/history/from-kas");
const { NetworkType } = await import("@/contexts/SettingsContext");

const ME = "kaspa:me";
const A = "kaspa:alice";
const B = "kaspa:bob";
const TX = "cd".repeat(32);
const T = 1_762_000_000_000;
const opts = { network: NetworkType.Mainnet, usdPrice: 0.1 };

const tx = (over: Partial<KaspaTxHistoryItem>): KaspaTxHistoryItem => ({
  txHash: TX,
  inputs: [],
  outputs: [],
  timeMs: T,
  isAccepted: true,
  ...over,
});

test("outgoing send to one recipient", () => {
  // 10 KAS in, 2.5 KAS to Alice, 7.49 KAS change → net −2.51 KAS (fee included).
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 1_000_000_000 }],
      outputs: [
        { address: A, amount: 250_000_000 },
        { address: ME, amount: 749_000_000 },
      ],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("out");
  expect(r.kind).toBe("send");
  expect(r.family).toBe("kas");
  expect(r.id).toBe(TX);
  expect(r.amount).toEqual({
    value: { raw: "251000000", decimals: 8, symbol: "KAS" },
    quality: "exact",
  });
  expect(r.counterparty).toEqual({ value: { address: A }, quality: "exact" });
  expect(r.time).toEqual({ value: T, quality: "exact" });
  expect(r.fiat.quality).toBe("approximate");
  expect(r.fiat.value?.usd).toBeCloseTo(0.251, 9);
  expect(r.status).toBe("finalized");
  expect(r.explorer?.url).toBe(`https://explorer.kaspa.org/txs/${TX}`);
  expect(r.fee.quality).toBe("unavailable");
});

test("incoming receive names the sender", () => {
  const r = toHistoryRecord(
    tx({
      inputs: [
        { address: B, amount: 300_000_000 },
        { address: B, amount: 300_000_000 },
      ],
      outputs: [
        { address: ME, amount: 500_000_000 },
        { address: B, amount: 99_000_000 },
      ],
      isAccepted: false,
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("in");
  expect(r.kind).toBe("receive");
  expect(r.amount.value?.raw).toBe("500000000");
  expect(r.counterparty).toEqual({ value: { address: B }, quality: "exact" });
  expect(r.status).toBe("pending");
});

test("self-transfer nets zero and names no one", () => {
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 100_000_000 }],
      outputs: [{ address: ME, amount: 100_000_000 }],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("self");
  expect(r.kind).toBe("self");
  expect(r.amount.value?.raw).toBe("100000000");
  expect(r.counterparty.quality).toBe("unavailable");
});

test("multi-recipient send leaves counterparty unavailable", () => {
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 1_000_000_000 }],
      outputs: [
        { address: A, amount: 100_000_000 },
        { address: B, amount: 100_000_000 },
      ],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("out");
  expect(r.counterparty).toEqual({ value: null, quality: "unavailable" });
});

test("missing time is unavailable; no price means no fiat", () => {
  const r = toHistoryRecord(
    tx({ timeMs: null, outputs: [{ address: ME, amount: 1 }] }),
    ME,
    { network: NetworkType.Mainnet },
  );
  expect(r.time).toEqual({ value: null, quality: "unavailable" });
  expect(r.fiat).toEqual({ value: null, quality: "unavailable" });
});

test("sompi sums stay exact past 2^53", () => {
  const big = 2 ** 53;
  const r = toHistoryRecord(
    tx({
      outputs: [
        { address: ME, amount: big },
        { address: ME, amount: 1 },
      ],
    }),
    ME,
    opts,
  );
  expect(r.amount.value?.raw).toBe((BigInt(big) + 1n).toString());
});

test("every input and output own: self whatever the fee, no counterparty", () => {
  // 10 KAS in, 9.99 KAS back to self: nets −0.01 KAS from the fee alone.
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 1_000_000_000 }],
      outputs: [{ address: ME, amount: 999_000_000 }],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("self");
  expect(r.kind).toBe("self");
  expect(r.counterparty.quality).toBe("unavailable");
});

test("one external recipient: send", () => {
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 1_000_000_000 }],
      outputs: [
        { address: B, amount: 100_000_000 },
        { address: ME, amount: 899_000_000 },
      ],
    }),
    ME,
    opts,
  );
  expect(r.kind).toBe("send");
  expect(r.direction).toBe("out");
  expect(r.counterparty).toEqual({ value: { address: B }, quality: "exact" });
});

test("self transfer: one own output (2.5 KAS) is the amount, never the fee", () => {
  // 2.51 KAS in, 2.5 KAS back in one own output: the 0.01 KAS fee is the net.
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 251_000_000 }],
      outputs: [{ address: ME, amount: 250_000_000 }],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("self");
  expect(r.amount).toEqual({
    value: { raw: "250000000", decimals: 8, symbol: "KAS" },
    quality: "exact",
  });
  expect(r.fiat.value?.usd).toBeCloseTo(0.25, 9);
});

test("self transfer with self and change outputs: amount unavailable", () => {
  // 150 KAS in, 100 KAS to self + 49.99 KAS change: the sum is the balance
  // minus the fee, not what moved, and nothing says which output is which.
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 15_000_000_000 }],
      outputs: [
        { address: ME, amount: 10_000_000_000 },
        { address: ME, amount: 4_999_000_000 },
      ],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("self");
  expect(r.amount).toEqual({ value: null, quality: "unavailable" });
  expect(r.fiat).toEqual({ value: null, quality: "unavailable" });
});

test("self transfer with no own outputs: amount unavailable", () => {
  // Zero-value own outputs: nothing moved and came back.
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: ME, amount: 100_000_000 }],
      outputs: [{ address: ME, amount: 0 }],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("self");
  expect(r.amount).toEqual({ value: null, quality: "unavailable" });
  expect(r.fiat).toEqual({ value: null, quality: "unavailable" });
});

test("unresolved input address with a net inflow: receive, not self", () => {
  const r = toHistoryRecord(
    tx({
      inputs: [{ address: "", amount: 600_000_000 }],
      outputs: [{ address: ME, amount: 500_000_000 }],
    }),
    ME,
    opts,
  );
  expect(r.direction).toBe("in");
  expect(r.kind).toBe("receive");
  expect(r.amount.value?.raw).toBe("500000000");
  expect(r.counterparty.quality).toBe("unavailable");
});
