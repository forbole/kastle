import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { schnorr } from "@noble/curves/secp256k1";
import {
  scriptP2pkh,
  type ProtocolInfo,
  type Quote,
  type TransactionPlan,
} from "@kasparocket/sdk";
import { bytesToHex, hexToBytes } from "viem";
import { planDigests } from "@/lib/kasparocket/adapter";
import {
  resighed,
  syntheticBuyPlan,
  syntheticBuyPlanUnbound,
} from "./fixtures/kasparocket-synthetic-buy";
import {
  KASPAROCKET_PLAN_TTL_MS,
  KaspaRocketPlanExpired,
  KaspaRocketSignRefusal,
  kastleKaspaRocketSigner,
  type KaspaRocketGuard,
} from "@/lib/kasparocket/signer";
import {
  claimKaspaRocketPair,
  kaspaRocketPendingKey,
  loadPendingKaspaRocket,
  releaseKaspaRocketPair,
  savePendingKaspaRocket,
  settlePendingKaspaRocket,
  type PendingKaspaRocketSwap,
} from "@/lib/kasparocket/pending";
import {
  kaspaRocketPlanNetworkFee,
  type KaspaRocketFees,
} from "@/lib/kasparocket/fees";
import {
  KASPAROCKET_PENDING_COPY,
  confirmKaspaRocketSwap,
  kaspaRocketFeeLines,
  kaspaRocketValidate,
  type KaspaRocketConfirmInput,
  type KaspaRocketPrepared,
} from "@/lib/kasparocket/confirm";

// SYNTHETIC: the hand-built v1 pool buy mobile's signer tests use; its key is
// a test key that owns nothing. No network, no broadcast.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/kasparocket-plan.synthetic.json"),
    "utf8",
  ),
);

function planOf(
  edit?: (tx: any) => void,
  over: Partial<TransactionPlan> = {},
): TransactionPlan {
  const raw = JSON.parse(JSON.stringify(syntheticBuyPlan(fixture)));
  edit?.(raw.transactions[0].tx);
  return {
    ...raw,
    summary: { ...raw.summary, kasFlowSompi: BigInt(raw.summary.kasFlowSompi) },
    ...over,
  };
}

function quoteOf(over: Partial<Quote> = {}): Quote {
  const q = fixture.quote;
  return {
    direction: q.direction,
    amountTokens: BigInt(q.amountTokens),
    amountTokensDisplay: "1",
    kasFlowSompi: BigInt(q.kasFlowSompi),
    fee: { treasury: 3_000_000n, partner: 0n, total: 3_000_000n },
    netKasSompi: BigInt(q.netKasSompi),
    uneconomic: q.uneconomic,
    phase: "bonding",
    reserveTokens: 0n,
    reserveKasSompi: 0n,
    spotBeforeSompi: 0n,
    spotAfterSompi: 0n,
    ...over,
  } as Quote;
}

// REAL: the vendor's /protocol document (fee addresses), as fetched 2026-11-26.
const protocolFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/kasparocket-protocol.real.json"),
    "utf8",
  ),
).protocol as ProtocolInfo;

const NOW = 1_000_000;
const guardOf = (over: Partial<KaspaRocketGuard> = {}): KaspaRocketGuard => ({
  quote: quoteOf(),
  trade: { tokenId: fixture.tokenId, direction: "buy", amountIn: 100_000_000n },
  lpCovenantId: fixture.lpCovenantId,
  slippageBps: 100n,
  builtAt: NOW,
  now: () => NOW,
  protocol: async () => protocolFixture,
  ...over,
});

/**
 * Stands in for the background's signInputDigest: signs the dotk digest of
 * `plan` (or `digestOf`'s answer) with `key`, sig64 || 0x01. Counts calls.
 */
function fakeSignDigest(
  plan: TransactionPlan,
  key = fixture.privateKeyHex as string,
  digestOf = (t: number, i: number) =>
    planDigests(plan).find((d) => d.txIndex === t && d.inputIndex === i)!
      .digest,
) {
  const calls: [number, number][] = [];
  const returned: Uint8Array[] = [];
  const fn = async (t: number, i: number) => {
    calls.push([t, i]);
    const sig = schnorr.sign(
      hexToBytes(`0x${digestOf(t, i)}`),
      hexToBytes(`0x${key}`),
    );
    returned.push(new Uint8Array([...sig, 0x01]));
    return returned[returned.length - 1];
  };
  return { fn, calls, returned };
}

async function expectRefused(
  plan: TransactionPlan,
  guard: KaspaRocketGuard,
  message: RegExp,
) {
  const sd = fakeSignDigest(plan);
  const result = kastleKaspaRocketSigner(
    sd.fn,
    fixture.xOnlyPk,
    guard,
  ).signPlan(plan);
  await expect(result).rejects.toThrow(KaspaRocketSignRefusal);
  await expect(result).rejects.toThrow(message);
  expect(sd.calls).toEqual([]);
}

const OTHER_KEY = `000020${"ab".repeat(32)}ac`;

test.describe("kastleKaspaRocketSigner", () => {
  test("places sig65 at scriptP2pkh and it verifies under the wallet key; the pool input is untouched", async () => {
    const plan = planOf();
    const sd = fakeSignDigest(plan);
    const [signed] = await kastleKaspaRocketSigner(
      sd.fn,
      fixture.xOnlyPk,
      guardOf(),
    ).signPlan(plan);
    expect(sd.calls).toEqual([[0, 0]]);
    const inputs = signed.inputs as {
      signatureScript: string;
      computeBudget: number;
    }[];
    const sig65 = bytesToHex(sd.returned[0]).slice(2);
    expect(inputs[0].signatureScript).toBe(scriptP2pkh(sig65));
    expect(inputs[0].signatureScript).toMatch(/^41[0-9a-f]{128}01$/);
    const [{ digest }] = planDigests(plan);
    expect(
      schnorr.verify(
        inputs[0].signatureScript.slice(2, 130),
        digest,
        fixture.xOnlyPk,
      ),
    ).toBe(true);
    expect(inputs[1].signatureScript).toBe("51");
    expect(inputs[1].computeBudget).toBe(10);
    expect((plan.transactions[0].tx.inputs as any[])[0].signatureScript).toBe(
      "",
    );
  });

  test("★ refuses the synthetic buy whose token cell no program binds", async () => {
    // The shape this spec used before the payout was bound to the cell's
    // bytes: the cell behind the pool's P2SH, no token program spent.
    const raw = syntheticBuyPlanUnbound(fixture) as any;
    const plan = {
      ...raw,
      summary: {
        ...raw.summary,
        kasFlowSompi: BigInt(raw.summary.kasFlowSompi),
      },
    } as TransactionPlan;
    await expectRefused(
      plan,
      guardOf(),
      /plan pays less than the minimum shown/,
    );
  });

  test("★ refuses a plan paying a non-allowlisted payee, signing nothing", async () => {
    await expectRefused(
      planOf((t) => (t.outputs[2].scriptPublicKey = OTHER_KEY)),
      guardOf(),
      /pays an address this wallet cannot spend/,
    );
    await expectRefused(
      planOf((t) => (t.outputs[1].scriptPublicKey = OTHER_KEY)),
      guardOf(),
      /pays an address this wallet cannot spend/,
    );
  });

  test("★ refuses a plan asking for a covenant-input signature", async () => {
    const plan = planOf();
    const planned = plan.transactions[0];
    await expectRefused(
      {
        ...plan,
        transactions: [
          {
            ...planned,
            signingInstructions: [
              planned.signingInstructions[0],
              {
                ...planned.signingInstructions[1],
                kind: "covenant-leader",
                sigscript: "00",
                sigOffsets: [0],
              } as any,
            ],
          },
        ],
      },
      guardOf(),
      /input 1 is a covenant input/,
    );
  });

  test("★ refuses a prepared sighash that disagrees with the local digest, before signing", async () => {
    // The transaction changed under an unchanged sighash.
    await expectRefused(
      planOf((t) => (t.outputs[2].value = "139999999")),
      guardOf(),
      /input 0 sighash does not match the prepared one/,
    );
    // The sighash changed under an unchanged transaction.
    const plan = planOf();
    const planned = plan.transactions[0];
    await expectRefused(
      {
        ...plan,
        transactions: [
          {
            ...planned,
            signingInstructions: [
              { ...planned.signingInstructions[0], sighash: "00".repeat(32) },
              planned.signingInstructions[1],
            ],
          },
        ],
      },
      guardOf(),
      /sighash does not match/,
    );
  });

  test("★ refuses a network fee over the 0.3 KAS ceiling, and signs one at it", async () => {
    // The fixture pays 9_999_000 sompi; 20_001_001 sompi less change makes 30_000_001.
    await expectRefused(
      planOf((t) => (t.outputs[2].value = "119998999")),
      guardOf(),
      /network fee 30000001 sompi is over the 30000000 sompi ceiling/,
    );
    const atCeiling = resighed(
      planOf((t) => (t.outputs[2].value = "119999000")),
    );
    const sd = fakeSignDigest(atCeiling);
    await expect(
      kastleKaspaRocketSigner(sd.fn, fixture.xOnlyPk, guardOf()).signPlan(
        atCeiling,
      ),
    ).resolves.toHaveLength(1);
  });

  test("★ refuses a stale plan every time; only a rebuilt plan signs", async () => {
    const plan = planOf();
    const sd = fakeSignDigest(plan);
    const stale = guardOf({ builtAt: NOW - KASPAROCKET_PLAN_TTL_MS - 1 });
    const signer = kastleKaspaRocketSigner(sd.fn, fixture.xOnlyPk, stale);
    await expect(signer.signPlan(plan)).rejects.toThrow(KaspaRocketPlanExpired);
    // Asking again does not quietly re-sign the same plan.
    await expect(signer.signPlan(plan)).rejects.toThrow(KaspaRocketPlanExpired);
    expect(sd.calls).toEqual([]);
    // At the TTL edge it still signs; a rebuild (fresh builtAt) signs.
    const edge = guardOf({ builtAt: NOW - KASPAROCKET_PLAN_TTL_MS });
    await expect(
      kastleKaspaRocketSigner(sd.fn, fixture.xOnlyPk, edge).signPlan(plan),
    ).resolves.toHaveLength(1);
  });

  test("fails closed when the background signs another digest (WASM vs dotk) or another key", async () => {
    const plan = planOf();
    const wrongDigest = fakeSignDigest(plan, undefined, () => "11".repeat(32));
    await expect(
      kastleKaspaRocketSigner(
        wrongDigest.fn,
        fixture.xOnlyPk,
        guardOf(),
      ).signPlan(plan),
    ).rejects.toThrow(/does not verify under the wallet key/);
    const wrongKey = fakeSignDigest(plan, "22".repeat(32));
    await expect(
      kastleKaspaRocketSigner(wrongKey.fn, fixture.xOnlyPk, guardOf()).signPlan(
        plan,
      ),
    ).rejects.toThrow(/does not verify under the wallet key/);
  });

  test("refuses a signature that is not 64 bytes + SIGHASH_ALL", async () => {
    const plan = planOf();
    const sd = fakeSignDigest(plan);
    const noType = async (t: number, i: number) =>
      (await sd.fn(t, i)).slice(0, 64);
    await expect(
      kastleKaspaRocketSigner(noType, fixture.xOnlyPk, guardOf()).signPlan(
        plan,
      ),
    ).rejects.toThrow(/not 64 bytes and SIGHASH_ALL/);
  });
});

/** browser.storage.local in memory, through JSON like the real store. */
function stubStorage() {
  const data: Record<string, unknown> = {};
  (globalThis as any).browser = {
    storage: {
      local: {
        async get(key: string) {
          return key in data ? { [key]: structuredClone(data[key]) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items))
            data[k] = JSON.parse(JSON.stringify(v));
        },
        async remove(key: string) {
          delete data[key];
        },
      },
    },
  };
  return data;
}

const swapOf = (pairKey: string): PendingKaspaRocketSwap => ({
  ref: "ab".repeat(32),
  pairKey,
  txids: ["ab".repeat(32)],
  direction: "buy",
  amountIn: 100_000_000n,
  startedAt: NOW,
});
const keyA = kaspaRocketPendingKey("mainnet", "kaspa:qa", "KAS:tokA");
const keyB = kaspaRocketPendingKey("mainnet", "kaspa:qa", "KAS:tokB");

test.describe("KaspaRocket pending store", () => {
  test.beforeEach(() => stubStorage());

  test("keys by network:address:pair", () => {
    expect(keyA).toBe("kasparocket_pending:mainnet:kaspa:qa:KAS:tokA");
  });

  test("a record written before submit is read back after a remount and holds the pair", async () => {
    expect(await claimKaspaRocketPair(keyA)).toBe(true);
    await savePendingKaspaRocket(keyA, swapOf("KAS:tokA"));
    // The popup closed: its in-memory claim is gone, storage is not.
    releaseKaspaRocketPair(keyA);
    expect(await loadPendingKaspaRocket(keyA)).toEqual(swapOf("KAS:tokA"));
    expect(await claimKaspaRocketPair(keyA)).toBe(false);
  });

  test("unknown keeps the record and reports pending, a throwing check too", async () => {
    await savePendingKaspaRocket(keyA, swapOf("KAS:tokA"));
    const seen: (readonly string[])[] = [];
    expect(
      await settlePendingKaspaRocket(keyA, async (txids) => {
        seen.push(txids);
        return "unknown";
      }),
    ).toBe("pending");
    expect(seen).toEqual([["ab".repeat(32)]]);
    expect(
      await settlePendingKaspaRocket(keyA, async () => {
        throw new Error("node down");
      }),
    ).toBe("pending");
    expect(await loadPendingKaspaRocket(keyA)).toBeDefined();
    expect(await claimKaspaRocketPair(keyA)).toBe(false);
  });

  for (const outcome of ["landed", "not-sent"] as const) {
    test(`${outcome} clears the record and frees the pair`, async () => {
      await savePendingKaspaRocket(keyA, swapOf("KAS:tokA"));
      expect(await settlePendingKaspaRocket(keyA, async () => outcome)).toBe(
        outcome,
      );
      expect(await loadPendingKaspaRocket(keyA)).toBeUndefined();
      expect(await claimKaspaRocketPair(keyA)).toBe(true);
      releaseKaspaRocketPair(keyA);
    });
  }

  test("nothing stored settles to undefined", async () => {
    expect(
      await settlePendingKaspaRocket(keyA, async () => "landed"),
    ).toBeUndefined();
  });

  test("two pairs do not block each other; one confirm per pair", async () => {
    expect(await claimKaspaRocketPair(keyA)).toBe(true);
    expect(await claimKaspaRocketPair(keyA)).toBe(false);
    expect(await claimKaspaRocketPair(keyB)).toBe(true);
    await savePendingKaspaRocket(keyA, swapOf("KAS:tokA"));
    releaseKaspaRocketPair(keyA);
    releaseKaspaRocketPair(keyB);
    expect(await claimKaspaRocketPair(keyB)).toBe(true);
    releaseKaspaRocketPair(keyB);
  });

  test("another account's or network's record is not picked up", async () => {
    await savePendingKaspaRocket(keyA, swapOf("KAS:tokA"));
    for (const other of [
      kaspaRocketPendingKey("mainnet", "kaspa:qb", "KAS:tokA"),
      kaspaRocketPendingKey("testnet-10", "kaspa:qa", "KAS:tokA"),
    ]) {
      expect(await loadPendingKaspaRocket(other)).toBeUndefined();
      expect(
        await settlePendingKaspaRocket(other, async () => "landed"),
      ).toBeUndefined();
      expect(await claimKaspaRocketPair(other)).toBe(true);
      releaseKaspaRocketPair(other);
    }
    expect(await loadPendingKaspaRocket(keyA)).toBeDefined();
  });

  test("pending.ts never submits, signs or imports the client", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../lib/kasparocket/pending.ts"),
      "utf8",
    );
    const code = src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    expect(code).not.toMatch(/submit\s*\(|signPlan|planSwap|fetch\s*\(/);
    expect(code).not.toMatch(/^import /m);
  });
});

test.describe("confirmKaspaRocketSwap (the hook's onConfirm)", () => {
  const FEES: KaspaRocketFees = {
    treasuryRate: 0.01,
    treasuryMinSompi: 200_000_000n,
    partnerRate: 0.005,
    partnerMinSompi: 100_000_000n,
    minOrderValueSompi: 15_000_000_000n,
    tokenDecimals: 8,
  };
  const prepared = (
    over: Partial<KaspaRocketPrepared> = {},
  ): KaspaRocketPrepared => ({
    quote: quoteOf(),
    plan: planOf(),
    key: "live",
    units: 100_000_000n,
    builtAt: NOW,
    ...over,
  });
  /** One confirm on `pair`, signing with the synthetic key; `submit` stubbed. */
  function confirmOn(
    pair: string,
    submit: KaspaRocketConfirmInput["submit"],
    over: Partial<KaspaRocketConfirmInput> = {},
  ) {
    const storeKey = kaspaRocketPendingKey("mainnet", "kaspa:qa", pair);
    const sd = fakeSignDigest(over.prepared?.plan ?? planOf());
    const records: number[] = [];
    const run = confirmKaspaRocketSwap({
      storeKey,
      pairKey: pair,
      prepared: prepared(),
      liveKey: "live",
      tokenId: fixture.tokenId,
      lpCovenantId: fixture.lpCovenantId,
      side: "buy",
      slippageBps: 100,
      xOnlyPk: fixture.xOnlyPk,
      protocol: async () => protocolFixture,
      signDigest: () => sd.fn,
      submit,
      onRecord: () => records.push(sd.calls.length),
      now: () => NOW,
      ...over,
    });
    return { run, storeKey, sd, records };
  }

  test("★ writes the pending record before submit: read inside the stubbed submit", async () => {
    const data = stubStorage();
    let seen: PendingKaspaRocketSwap | undefined;
    let submits = 0;
    const c = confirmOn("KAS:order", async () => {
      submits++;
      seen = await loadPendingKaspaRocket(c.storeKey);
    });
    const r = await c.run;
    expect(submits).toBe(1);
    expect(seen?.pairKey).toBe("KAS:order");
    expect(String(seen?.amountIn)).toBe("100000000");
    // The record went down before the first signature was asked for.
    expect(c.records).toEqual([0]);
    expect(c.sd.calls.length).toBeGreaterThan(0);
    expect(r).toEqual({ pending: true, submitted: true });
    expect(Object.keys(data)).toEqual([c.storeKey]);
  });

  test("★ a submit that never answers: record stays, pending; a remount settles to pending with 0 submits", async () => {
    stubStorage();
    let submits = 0;
    const c = confirmOn("KAS:hang", () => {
      submits++;
      return new Promise(() => {});
    });
    let done = false;
    void c.run.then(() => (done = true));
    await expect.poll(() => submits).toBe(1);
    expect(done).toBe(false);
    expect(c.records).toEqual([0]);
    expect(await loadPendingKaspaRocket(c.storeKey)).toBeDefined();
    // The popup reopens: the record is settled from the chain only.
    let checks = 0;
    const outcome = await settlePendingKaspaRocket(c.storeKey, async () => {
      checks++;
      return "unknown";
    });
    expect(outcome).toBe("pending");
    expect(checks).toBe(1);
    // A confirm on the reopened popup is refused: nothing signed or sent.
    const again = confirmOn("KAS:hang", async () => {
      submits++;
    });
    expect((await again.run).pending).toBe(true);
    expect(again.sd.calls).toEqual([]);
    expect(submits).toBe(1);
  });

  test("★ a guard refusal writes no record, signs nothing, submits nothing", async () => {
    const data = stubStorage();
    let submits = 0;
    const c = confirmOn(
      "KAS:refuse",
      async () => {
        submits++;
      },
      { prepared: prepared({ quote: quoteOf({ uneconomic: true }) }) },
    );
    const r = await c.run;
    expect(r.pending).toBe(false);
    expect(r.message).toMatch(/uneconomic/);
    expect(c.sd.calls).toEqual([]);
    expect(submits).toBe(0);
    expect(data).toEqual({});
  });

  test("★ a refusal after the record (the signature fails) clears it and submits nothing", async () => {
    const data = stubStorage();
    let submits = 0;
    const c = confirmOn(
      "KAS:signfail",
      async () => {
        submits++;
      },
      {
        signDigest: () => async () => {
          throw new KaspaRocketSignRefusal("background refused");
        },
      },
    );
    const r = await c.run;
    expect(c.records).toEqual([0]);
    expect(r.pending).toBe(false);
    expect(submits).toBe(0);
    expect(data).toEqual({});
  });

  test("★ a second confirm while the first signs plans nothing and signs nothing", async () => {
    stubStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let submits = 0;
    const first = confirmOn("KAS:double", async () => {
      submits++;
      await gate;
    });
    await expect.poll(() => submits).toBe(1);
    const second = confirmOn("KAS:double", async () => {
      submits++;
    });
    expect(await second.run).toEqual({
      pending: true,
      message: KASPAROCKET_PENDING_COPY,
    });
    expect(second.sd.calls).toEqual([]);
    release();
    await first.run;
    expect(submits).toBe(1);
  });

  test("★ a stale or changed plan is refused before any record", async () => {
    const data = stubStorage();
    const stale = confirmOn("KAS:stale", async () => {}, {
      now: () => NOW + KASPAROCKET_PLAN_TTL_MS + 1,
    });
    expect((await stale.run).rebuild).toBe(true);
    const changed = confirmOn("KAS:stale", async () => {}, {
      liveKey: "other",
    });
    expect((await changed.run).pending).toBe(false);
    expect(stale.sd.calls).toEqual([]);
    expect(changed.sd.calls).toEqual([]);
    expect(data).toEqual({});
  });

  test("★ fee lines are the plan's own; a missing figure drops its line, never 0", () => {
    const plan = planOf(undefined, {
      summary: { ...planOf().summary, totalPlatformFeeSompi: 300_000_000n },
    });
    const network = kaspaRocketPlanNetworkFee(plan)!;
    const lines = kaspaRocketFeeLines(plan, 100_000_000n, FEES);
    expect(lines.map((l) => l.name)).toEqual(["Network", "KaspaRocket"]);
    expect(lines[0].amount).toBe(Number(network) / 1e8);
    expect(lines[1].amount).toBe(3);
    expect(lines[1].display).toBe("3 KAS");
    const noSummary = planOf(undefined, {
      summary: {
        ...planOf().summary,
        totalPlatformFeeSompi: undefined,
        platformFeeSompi: undefined,
      },
    });
    expect(
      kaspaRocketFeeLines(noSummary, 100_000_000n, FEES).map((l) => l.name),
    ).toEqual(["Network"]);
    expect(kaspaRocketFeeLines(undefined, 100_000_000n, FEES)).toEqual([]);
    for (const l of kaspaRocketFeeLines(noSummary, undefined, undefined))
      expect(l.amount).not.toBe(0);
  });

  test("★ validateAmount: under 150 KAS blocks with mobile's copy; nothing while protocol() is unknown", () => {
    const kas = (n: number) => BigInt(n) * 100_000_000n;
    expect(kaspaRocketValidate(kas(149), kas(1000), kas(149), FEES)).toBe(
      "KaspaRocket's minimum trade is 150 KAS.",
    );
    expect(
      kaspaRocketValidate(kas(150), kas(1000), kas(150), FEES),
    ).toBeUndefined();
    expect(
      kaspaRocketValidate(kas(149), kas(1000), kas(149), undefined),
    ).toBeUndefined();
    expect(kaspaRocketValidate(kas(2000), kas(1000), kas(2000), FEES)).toBe(
      "Oh, you don't have enough funds",
    );
  });
});
