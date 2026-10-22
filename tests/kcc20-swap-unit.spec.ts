import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { client, curve, curveCp, kcc20, partnerTag } from "@kronsdk/kron-sdk";
import { bytesToHex, hexToBytes } from "viem";
import * as kaspa from "@/wasm/core/kaspa";

registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const {
  KronSwapError,
  buildKronSwap,
  isSequencerUnreachable,
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
    "market-busy",
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
  const FUND_A = { transactionId: "ee".repeat(32), index: 0 };
  const FUND_B = { transactionId: "ff".repeat(32), index: 1 };
  type Pin = typeof FUND_A;
  const funding = (...utxos: [Pin, bigint][]) =>
    utxos.map(([outpoint, kas]) => ({
      entry: {},
      address,
      outpoint,
      amount: kas * KAS,
      scriptPublicKey: kaspa.payToAddressScript(address),
      blockDaaScore: 0n,
      isCoinbase: false,
    })) as unknown as Parameters<typeof fundCovenantSpend>[0]["funding"];
  const fund = (
    s: ReturnType<typeof curveCp.buildCpBuy>,
    from = funding([FUND_A, 10_000n]),
    preferOutpoint?: Pin,
  ) => fundCovenantSpend({ spend: s, funding: from, address, preferOutpoint });
  const buy = (tokenOut = KAS) =>
    curveCp.buildCpBuy(
      k,
      cpTpl,
      tokenTpl,
      utxo(),
      inventory(),
      COVID,
      xonly,
      1000n * KAS,
      tokenOut,
      [],
      2,
    );
  const market = {
    covenantId: "ab".repeat(32),
    curveCovenantId: "cd".repeat(32),
    tick: "TEST",
    entry: {
      decimals: 8,
      extensions: { curveParams: {}, templateVersion: null },
    },
  } as unknown as Parameters<typeof submitKronSwap>[3];
  // Signing is out of scope here: the wallet hands the tx back as-is.
  const wallet = {
    signTx: async (tx: kaspa.Transaction) => tx,
  } as unknown as Parameters<typeof submitKronSwap>[0];
  type Seq = InstanceType<typeof client.SequencerClient>;
  type SubmitBody = Parameters<Seq["curveSubmit"]>[0];
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      (e) => (e instanceof KronSwapError ? e.code : String(e)),
    );

  test("a pinned funding input is spent first; a spent one is ignored", () => {
    const both = () => funding([FUND_A, 10_000n], [FUND_B, 20_000n]);
    expect(fund(buy(), both()).fundingOutpoints).toEqual([FUND_B]);
    expect(fund(buy(), both(), FUND_A).fundingOutpoints).toEqual([FUND_A]);
    expect(
      fund(buy(), funding([FUND_B, 20_000n]), FUND_A).fundingOutpoints,
    ).toEqual([FUND_B]);
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
    type SubmitResult = Awaited<ReturnType<Seq["curveSubmit"]>>;
    type StatusResult = Awaited<ReturnType<Seq["curveStatus"]>>;
    type Built = Parameters<typeof submitKronSwap>[1];
    type Rebuild = NonNullable<Parameters<typeof submitKronSwap>[4]>;
    const proto = client.SequencerClient.prototype;
    const original = {
      curveSubmit: proto.curveSubmit,
      curveStatus: proto.curveStatus,
    };
    let submits: SubmitBody[];
    let statusCalls: number;
    let mempoolCalls: number;
    let direct: string[];
    let rebuilds: { pin?: Pin; direct?: boolean; built: Built }[];

    // Each call to curveSubmit takes the next scripted response; an Error is
    // thrown, like a dropped connection. `status` answers each curveStatus;
    // an Error is thrown, and none is an unreachable sequencer.
    const stub = (
      responses: (SubmitResult | Error)[],
      status?:
        | Partial<StatusResult>
        | ((call: number) => Partial<StatusResult>)
        | Error,
    ) => {
      submits = [];
      statusCalls = 0;
      proto.curveSubmit = async (body) => {
        submits.push(body);
        const res = responses[submits.length - 1];
        if (res instanceof Error) throw res;
        return res;
      };
      proto.curveStatus = async (_covid, txid) => {
        statusCalls++;
        if (!status) throw new TypeError("Failed to fetch");
        if (status instanceof Error) throw status;
        const st = typeof status === "function" ? status(statusCalls) : status;
        return { ok: true, known: true, state: "unknown", txid, ...st };
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
    const rpc = (inMempool: boolean) =>
      ({
        getMempoolEntry: async () => {
          mempoolCalls++;
          return { mempoolEntry: inMempool ? {} : undefined };
        },
        submitTransaction: async ({
          transaction,
        }: {
          transaction: kaspa.Transaction;
        }) => {
          direct.push(transaction.id);
          return { transactionId: transaction.id };
        },
      }) as unknown as Parameters<typeof submitKronSwap>[2];
    // tokenOut varies the outputs, so every rebuild gets a new txid.
    const built = (
      from?: ReturnType<typeof funding>,
      pin?: Pin,
      tokenOut = KAS,
    ) =>
      ({
        ...fund(buy(tokenOut), from, pin),
        quote: quoteKron(state, "buy", 1000n * KAS)!,
        head,
        submitDirect: false,
      }) satisfies Built;
    // The wallet gained a bigger UTXO since: only the pin keeps FUND_A first.
    const rebuild: Rebuild = async (pin, toNode) => {
      const b = built(
        funding([FUND_A, 10_000n], [FUND_B, 20_000n]),
        pin,
        KAS + BigInt(rebuilds.length + 1),
      );
      rebuilds.push({ pin, direct: toNode, built: b });
      return b;
    };
    const stale = {
      ok: false,
      reason: "stale-head",
      retry: true,
    } as const satisfies SubmitResult;
    const reject = {
      ok: false,
      reason: "reserve-mismatch",
    } as const satisfies SubmitResult;
    const ambiguous = {
      ok: false,
      reason: "timeout",
      ambiguous: true,
    } as const satisfies SubmitResult;
    const accepted = (txid: string) =>
      ({ ok: true, txid, position: 0 }) as const satisfies SubmitResult;
    const dropped = new TypeError("Failed to fetch");
    const run = async (
      b: Built,
      inMempool = false,
      rb: Rebuild | null = rebuild,
    ) => {
      mempoolCalls = 0;
      direct = [];
      rebuilds = [];
      return submitKronSwap(wallet, b, rpc(inMempool), market, rb ?? undefined);
    };

    test("a stale head rebuilds on the fresh head and resubmits", async () => {
      const b = built();
      stub([stale, accepted("next")], { state: "rejected" });
      expect(await run(b)).toBe("next");
      expect(submits).toHaveLength(2);
      expect(submits[0].signedTx).toBe(b.transaction.serializeToSafeJSON());
      expect(submits[1].signedTx).not.toBe(submits[0].signedTx);
      expect(submits[1].signedTx).toBe(
        rebuilds[0].built.transaction.serializeToSafeJSON(),
      );
      // Reconciled dead before the rebuild; queued, never direct.
      expect(statusCalls).toBe(1);
      expect(rebuilds.map((r) => [r.pin, r.direct])).toEqual([[FUND_A, false]]);
      expect(direct).toHaveLength(0);
    });

    test("a rebuild reuses a funding outpoint from the previous attempt", async () => {
      const b = built();
      stub([stale, accepted("next")], { state: "dropped" });
      await run(b);
      const next = rebuilds[0].built.fundingOutpoints;
      expect(
        b.fundingOutpoints.some((o) =>
          next.some(
            (n) => n.transactionId === o.transactionId && n.index === o.index,
          ),
        ),
      ).toBe(true);
      // Without the pin the bigger fresh UTXO would fund it alone.
      expect(
        built(funding([FUND_A, 10_000n], [FUND_B, 20_000n])).fundingOutpoints,
      ).toEqual([FUND_B]);
    });

    test("contention past 3 attempts is market busy, never direct", async () => {
      stub([stale, stale, stale, accepted("late")], { state: "rejected" });
      expect(await codeOf(run(built()))).toBe("market-busy");
      expect(submits).toHaveLength(3);
      expect(new Set(submits.map((b) => b.signedTx)).size).toBe(3);
      expect(rebuilds.map((r) => r.direct)).toEqual([false, false]);
      expect(direct).toHaveLength(0);
      // No rebuild callback: fail safe on the first retry.
      stub([stale], { state: "rejected" });
      expect(await codeOf(run(built(), false, null))).toBe("market-busy");
      expect(submits).toHaveLength(1);
    });

    test("the sequencer vanishing mid-retry never goes direct", async () => {
      stub([stale], { state: "rejected" });
      const gone: Rebuild = async (pin) => ({
        ...built(undefined, pin, 2n * KAS),
        submitDirect: true,
      });
      expect(await codeOf(run(built(), false, gone))).toBe("market-busy");
      expect(submits).toHaveLength(1);
      expect(direct).toHaveLength(0);
    });

    test("a rebuild that lost the pinned input is not resubmitted", async () => {
      stub([stale], { state: "rejected" });
      const unpinned: Rebuild = async () =>
        built(funding([FUND_B, 20_000n]), undefined, 2n * KAS);
      expect(await codeOf(run(built(), false, unpinned))).toBe("processing");
      expect(submits).toHaveLength(1);
    });

    test("a rebuild never raises the reviewed network fee", async () => {
      stub([stale], { state: "rejected" });
      const dearer: Rebuild = async (pin) => {
        const n = built(undefined, pin, 2n * KAS);
        return { ...n, fee: n.fee + 1n };
      };
      expect(await codeOf(run(built(), false, dearer))).toBe("price-moved");
      expect(submits).toHaveLength(1);
    });

    test("a live trade surfaces as processing, never a rebuild", async () => {
      for (const st of ["accepted", "broadcasting", "broadcast-ambiguous"]) {
        stub([stale], { state: st as StatusResult["state"] });
        expect(await codeOf(run(built()))).toBe("processing");
        expect(mempoolCalls).toBe(0);
        expect(rebuilds).toHaveLength(0);
      }
    });

    test("ambiguous broadcast reconciles before any rebuild", async () => {
      stub([ambiguous], { state: "confirmed" });
      expect(await codeOf(run(built()))).toBe("processing");
      expect(submits).toHaveLength(1);
      expect(statusCalls).toBe(1);
      expect(rebuilds).toHaveLength(0);
      // Provably dead: rebuilt and queued via the sequencer, never direct.
      stub([ambiguous, accepted("next")], { state: "dropped" });
      expect(await run(built())).toBe("next");
      expect(rebuilds.map((r) => r.direct)).toEqual([false]);
      expect(direct).toHaveLength(0);
    });

    test("a rejected or dropped trade is safe to rebuild", async () => {
      for (const st of ["rejected", "dropped"] as const) {
        stub([stale, accepted("next")], { state: st });
        expect(await run(built())).toBe("next");
        expect(rebuilds).toHaveLength(1);
        expect(mempoolCalls).toBe(0);
      }
    });

    test("a txid the sequencer forgot falls back to the node mempool", async () => {
      stub([stale], { known: false });
      expect(await codeOf(run(built(), true))).toBe("processing");
      expect(mempoolCalls).toBe(1);
      expect(rebuilds).toHaveLength(0);
      stub([stale, accepted("next")], { known: false });
      expect(await run(built(), false)).toBe("next");
      expect(mempoolCalls).toBe(1);
      // curveStatus unreachable: same chain fallback.
      stub([stale]);
      expect(await codeOf(run(built(), true))).toBe("processing");
    });

    test("a dropped submit on a live trade surfaces as processing", async () => {
      for (const st of ["accepted", "confirmed"] as const) {
        stub([dropped], { state: st });
        expect(await codeOf(run(built()))).toBe("processing");
        expect(submits).toHaveLength(1);
        expect(statusCalls).toBe(1);
      }
      // Dropped on the resubmit after a stale head.
      stub([stale, dropped], (n) => ({
        state: n === 1 ? "rejected" : "broadcasting",
      }));
      expect(await codeOf(run(built()))).toBe("processing");
      expect(submits).toHaveLength(2);
      expect(direct).toHaveLength(0);
      // Forgotten by the sequencer but still in the node mempool.
      stub([dropped], { known: false });
      expect(await codeOf(run(built(), true))).toBe("processing");
      expect(mempoolCalls).toBe(1);
    });

    test("a dropped submit with a reachable sequencer resends the identical tx", async () => {
      const b = built();
      // Forgotten by the sequencer and absent from the node mempool.
      stub([dropped, accepted("dup")], { known: false });
      expect(await run(b)).toBe("dup");
      expect(submits).toHaveLength(2);
      expect(submits[1].signedTx).toBe(submits[0].signedTx);
      expect(submits[0].signedTx).toBe(b.transaction.serializeToSafeJSON());
      expect(mempoolCalls).toBe(1);
      expect(rebuilds).toHaveLength(0);
      expect(direct).toHaveLength(0);
    });

    test("a dropped submit with an unreachable sequencer goes direct", async () => {
      stub([dropped]);
      const txid = await run(built());
      expect(submits).toHaveLength(1);
      expect(rebuilds.map((r) => [r.pin, r.direct])).toEqual([[FUND_A, true]]);
      expect(direct).toEqual([rebuilds[0].built.transaction.id]);
      expect(txid).toBe(direct[0]);
      // No rebuild callback: fail safe.
      stub([dropped]);
      expect(await codeOf(run(built(), false, null))).toBe("market-busy");
      expect(direct).toHaveLength(0);
    });

    test("a dropped submit with a curveStatus HTTP error never goes direct", async () => {
      stub([dropped, dropped], new Error("sequencer curve status -> HTTP 500"));
      expect(await codeOf(run(built()))).toBe("processing");
      expect(submits).toHaveLength(2);
      expect(submits[1].signedTx).toBe(submits[0].signedTx);
      expect(rebuilds).toHaveLength(0);
      expect(direct).toHaveLength(0);
    });

    test("a dropped submit with a curveStatus fetch failure goes direct", async () => {
      stub([dropped], new TypeError("Failed to fetch"));
      const txid = await run(built());
      expect(rebuilds.map((r) => r.direct)).toEqual([true]);
      expect(direct).toEqual([txid]);
    });

    test("only a transport failure reads as an unreachable sequencer", () => {
      for (const e of [
        new TypeError("Failed to fetch"),
        new TypeError("Network request failed"),
        new Error("connect ECONNREFUSED 127.0.0.1:443"),
        new Error("getaddrinfo ENOTFOUND seq.kron.technology"),
        new Error("socket hang up"),
        new DOMException("The operation was aborted", "AbortError"),
        new DOMException("signal timed out", "TimeoutError"),
      ]) {
        expect(isSequencerUnreachable(e)).toBe(true);
      }
      for (const e of [
        new Error("sequencer curve status -> HTTP 500"),
        new Error("sequencer curve status -> HTTP 429"),
        new Error("HTTP 502: ECONNRESET upstream"),
        new SyntaxError("Unexpected token < in JSON at position 0"),
        new Error("sequencer down"),
        "Failed to fetch",
        undefined,
      ]) {
        expect(isSequencerUnreachable(e)).toBe(false);
      }
    });

    test("a dropped resend with a reachable sequencer stays processing", async () => {
      stub([dropped, dropped], { state: "rejected" });
      expect(await codeOf(run(built()))).toBe("processing");
      expect(submits).toHaveLength(2);
      expect(submits[1].signedTx).toBe(submits[0].signedTx);
      expect(statusCalls).toBe(2);
      expect(rebuilds).toHaveLength(0);
      expect(direct).toHaveLength(0);
    });

    test("a definitive reject goes direct to the node once dead", async () => {
      stub([reject], { state: "rejected" });
      const txid = await run(built());
      expect(submits).toHaveLength(1);
      expect(statusCalls).toBe(1);
      expect(rebuilds.map((r) => [r.pin, r.direct])).toEqual([[FUND_A, true]]);
      expect(direct).toEqual([txid]);
      // Still live: a direct rebuild would be a second trade.
      stub([reject], { state: "accepted" });
      expect(await codeOf(run(built()))).toBe("processing");
      expect(direct).toHaveLength(0);
    });
  });

  test.describe("live curve head", () => {
    const proto = client.SequencerClient.prototype;
    const original = {
      curveHead: proto.curveHead,
      curveSubmit: proto.curveSubmit,
    };
    const originalFetch = globalThis.fetch;
    let submits: SubmitBody[];
    let direct: string[];
    // The registry's cp-template and the indexer's token record.
    test.beforeEach(() => {
      submits = [];
      direct = [];
      globalThis.fetch = async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/cp-template")
              ? {
                  token: {
                    scriptHex: bytesToHex(tokenTpl.script),
                    stateStart: tokenTpl.stateStart,
                    maxIns: 4,
                    maxOuts: 4,
                  },
                  pool: { scriptHex: "", stateStart: 0 },
                  curve: {
                    scriptHex: bytesToHex(cpTpl.script),
                    stateStart: cpTpl.stateStart,
                  },
                  params: {
                    tradeRecipientBound: 1,
                    creatorFeeOwner: bytesToHex(xonly),
                    platformFeeOwner: bytesToHex(xonly),
                    vKas: String(state.vKas),
                    graduationKas: String(state.graduationKas),
                    creatorFeeBps: 50,
                    platformFeeBps: 50,
                    graduationFeeBps: 0,
                  },
                }
              : {
                  result: { graduated: false, tokenReserve: String(RESERVE) },
                },
          ),
        );
      proto.curveSubmit = async (body) => {
        submits.push(body);
        return { ok: true, txid: "seq", position: 0 };
      };
    });
    test.afterEach(() => {
      Object.assign(proto, original);
      globalThis.fetch = originalFetch;
    });

    // Curve + inventory on the node, then the wallet's funding.
    const rpc = {
      getUtxosByAddresses: async (addresses: string[]) => ({
        entries:
          addresses.length === 2
            ? [
                {
                  outpoint: outpoint(1),
                  entry: { covenantId: "cd".repeat(32), amount: state.realKas },
                },
                {
                  outpoint: outpoint(2),
                  entry: { covenantId: "ab".repeat(32), amount: 50_000_000n },
                },
              ]
            : funding([FUND_A, 10_000n]),
      }),
      submitTransaction: async ({
        transaction,
      }: {
        transaction: kaspa.Transaction;
      }) => {
        direct.push(transaction.id);
        return { transactionId: transaction.id };
      },
    } as unknown as Parameters<typeof submitKronSwap>[2];
    const build = () =>
      buildKronSwap({
        rpc,
        market,
        side: "buy",
        amountIn: 1000n * KAS,
        minOut: 0n,
        address,
      });

    test("a null head is synthesised from the node and sent to the sequencer", async () => {
      proto.curveHead = async () => ({ ok: true, head: null, depth: 0 });
      const b = await build();
      expect(b.submitDirect).toBe(false);
      expect(await submitKronSwap(wallet, b, rpc, market)).toBe("seq");
      expect(submits).toHaveLength(1);
      expect(submits[0].prevHead.poolOutpoint).toEqual(outpoint(1));
      expect(submits[0].prevHead.poolTokenOutpoint).toEqual(outpoint(2));
      expect(submits[0].prevHead.reserves).toEqual({
        realKas: String(state.realKas),
        tokenReserve: String(RESERVE),
        vKas: String(state.vKas),
      });
      expect(direct).toHaveLength(0);
    });

    test("an unreachable sequencer submits direct to the node", async () => {
      const heads: Seq["curveHead"][] = [
        async () => {
          throw new TypeError("Failed to fetch");
        },
        async () => ({ ok: false, reason: "unknown curve" }),
      ];
      for (const curveHead of heads) {
        proto.curveHead = curveHead;
        direct = [];
        const b = await build();
        expect(b.submitDirect).toBe(true);
        expect(await submitKronSwap(wallet, b, rpc, market)).toBe(
          b.transaction.id,
        );
        expect(direct).toEqual([b.transaction.id]);
      }
      expect(submits).toHaveLength(0);
    });
  });
});
