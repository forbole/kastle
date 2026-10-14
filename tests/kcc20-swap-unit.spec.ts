import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { client, curve, curveCp, kcc20, partnerTag } from "@kronsdk/kron-sdk";
import { hexToBytes } from "viem";
import * as kaspa from "@/wasm/core/kaspa";

registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const {
  KronSwapError,
  kronErrorCopy,
  kronKastleFee,
  kronKastleFeeBps,
  quoteKron,
  submitKronSwap,
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
    "processing",
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

  test("both serializers round-trip a curve trade to the same txid", () => {
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
    const { transaction } = fund(s);
    // The sequencer re-decodes the submitted signedTx and recomputes its txid
    // (which excludes signature scripts), so any serializer that decodes to
    // the same transaction must produce the same id. SafeJSON is what we send;
    // plain JSON is the other serializer worth pinning in CI.
    const safe = kaspa.Transaction.deserializeFromSafeJSON(
      transaction.serializeToSafeJSON(),
    ).id;
    const json = kaspa.Transaction.deserializeFromJSON(
      transaction.serializeToJSON(),
    ).id;
    expect(safe).toBe(transaction.id);
    expect(json).toBe(transaction.id);
  });

  test("a curve trade carries the Kastle partner tag through SafeJSON", () => {
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
    const { transaction } = fund(s);
    const tag = partnerTag.encodePartnerTag("kastlewallet");
    expect(tag).not.toBe("");
    expect(transaction.payload).toBe(tag);
    // SafeJSON is what the sequencer receives.
    const sent = kaspa.Transaction.deserializeFromSafeJSON(
      transaction.serializeToSafeJSON(),
    );
    expect(partnerTag.parsePartnerTag(sent.payload)).toBe("kastlewallet");
  });

  test.describe("sequencer submit", () => {
    type Seq = InstanceType<typeof client.SequencerClient>;
    type SubmitResult = Awaited<ReturnType<Seq["curveSubmit"]>>;
    type StatusResult = Awaited<ReturnType<Seq["curveStatus"]>>;
    const proto = client.SequencerClient.prototype;
    const original = {
      curveSubmit: proto.curveSubmit,
      curveStatus: proto.curveStatus,
    };
    let submits: string[];
    let statusCalls: number;
    let mempoolCalls: number;

    // Each call to curveSubmit takes the next scripted response; an Error is
    // thrown, like a dropped connection.
    const stub = (
      responses: (SubmitResult | Error)[],
      status?: Partial<StatusResult>,
    ) => {
      submits = [];
      statusCalls = 0;
      proto.curveSubmit = async (body) => {
        submits.push(body.signedTx);
        const res = responses[submits.length - 1];
        if (res instanceof Error) throw res;
        return res;
      };
      proto.curveStatus = async (_covid, txid) => {
        statusCalls++;
        if (!status) throw new Error("sequencer down");
        return { ok: true, known: true, state: "unknown", txid, ...status };
      };
    };
    test.afterEach(() => Object.assign(proto, original));

    const head = {
      poolOutpoint: outpoint(1),
      poolTokenOutpoint: outpoint(2),
      reserves: {
        realKas: state.realKas.toString(),
        tokenReserve: RESERVE.toString(),
        vKas: state.vKas.toString(),
      },
    };
    const market = {
      covenantId: "ab".repeat(32),
      curveCovenantId: "cd".repeat(32),
      tick: "TEST",
    } as Parameters<typeof submitKronSwap>[3];
    // Signing is out of scope here: the wallet hands the tx back as-is.
    const wallet = {
      signTx: async (tx: kaspa.Transaction) => tx,
    } as unknown as Parameters<typeof submitKronSwap>[0];
    const rpc = (inMempool: boolean) =>
      ({
        getMempoolEntry: async () => {
          mempoolCalls++;
          return { mempoolEntry: inMempool ? {} : undefined };
        },
      }) as unknown as Parameters<typeof submitKronSwap>[2];
    const built = () => ({
      ...fund(
        curveCp.buildCpBuy(
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
        ),
      ),
      quote: quoteKron(state, "buy", 1000n * KAS)!,
      head,
    });
    const stale = {
      ok: false,
      reason: "stale-head",
      retry: true,
    } as const satisfies SubmitResult;
    const accepted = (txid: string) =>
      ({ ok: true, txid, position: 0 }) as const satisfies SubmitResult;
    const run = async (b: ReturnType<typeof built>, inMempool = false) => {
      mempoolCalls = 0;
      return submitKronSwap(wallet, b, rpc(inMempool), market);
    };
    const codeOf = (p: Promise<unknown>) =>
      p.then(
        () => "resolved",
        (e) => (e instanceof KronSwapError ? e.code : String(e)),
      );

    test("a stale head is resent once with the identical string", async () => {
      const b = built();
      stub([stale, accepted(b.transaction.id)]);
      expect(await run(b)).toBe(b.transaction.id);
      expect(submits).toHaveLength(2);
      expect(submits[1]).toBe(submits[0]);
      expect(submits[0]).toBe(b.transaction.serializeToSafeJSON());
      expect(statusCalls).toBe(0);
    });

    test("a live trade surfaces as processing, never a rebuild", async () => {
      for (const st of ["accepted", "broadcasting", "broadcast-ambiguous"]) {
        stub([stale, stale], { state: st as StatusResult["state"] });
        expect(await codeOf(run(built()))).toBe("processing");
        expect(mempoolCalls).toBe(0);
      }
    });

    test("ambiguous broadcast reconciles without a resend", async () => {
      stub([{ ok: false, reason: "timeout", ambiguous: true }], {
        state: "confirmed",
      });
      expect(await codeOf(run(built()))).toBe("processing");
      expect(submits).toHaveLength(1);
      expect(statusCalls).toBe(1);
    });

    test("a rejected or dropped trade is safe to rebuild", async () => {
      for (const st of ["rejected", "dropped"] as const) {
        stub([stale, stale], { state: st });
        expect(await codeOf(run(built()))).toBe("curve-busy");
        expect(mempoolCalls).toBe(0);
      }
    });

    test("a txid the sequencer forgot falls back to the node mempool", async () => {
      stub([stale, stale], { known: false });
      expect(await codeOf(run(built(), true))).toBe("processing");
      expect(mempoolCalls).toBe(1);
      stub([stale, stale], { known: false });
      expect(await codeOf(run(built(), false))).toBe("curve-busy");
      expect(mempoolCalls).toBe(1);
      // curveStatus unreachable: same chain fallback.
      stub([stale, stale]);
      expect(await codeOf(run(built(), true))).toBe("processing");
    });

    test("a dropped submit on a live trade surfaces as processing", async () => {
      const dropped = new TypeError("Failed to fetch");
      for (const st of ["accepted", "confirmed"] as const) {
        stub([dropped], { state: st });
        expect(await codeOf(run(built()))).toBe("processing");
        expect(submits).toHaveLength(1);
        expect(statusCalls).toBe(1);
      }
      // Dropped on the resend after a stale head.
      stub([stale, dropped], { state: "broadcasting" });
      expect(await codeOf(run(built()))).toBe("processing");
      expect(submits).toHaveLength(2);
      // Forgotten by the sequencer but still in the node mempool.
      stub([dropped], { known: false });
      expect(await codeOf(run(built(), true))).toBe("processing");
      expect(mempoolCalls).toBe(1);
    });

    test("a dropped submit on a dead trade re-throws for a rebuild", async () => {
      const dropped = new TypeError("Failed to fetch");
      stub([dropped], { state: "rejected" });
      await expect(run(built())).rejects.toBe(dropped);
      expect(statusCalls).toBe(1);
      // Forgotten by the sequencer and absent from the node mempool.
      stub([dropped], { known: false });
      await expect(run(built(), false)).rejects.toBe(dropped);
      expect(statusCalls).toBe(1);
      expect(mempoolCalls).toBe(1);
    });

    test("a hard refusal is not reconciled", async () => {
      stub([{ ok: false, reason: "bad reserves" }]);
      expect(await codeOf(run(built()))).toBe("curve-busy");
      expect(submits).toHaveLength(1);
      expect(statusCalls).toBe(0);
    });
  });
});
