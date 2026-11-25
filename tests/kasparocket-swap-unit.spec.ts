import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { schnorr } from "@noble/curves/secp256k1";
import { scriptP2pkh, type Quote, type TransactionPlan } from "@kasparocket/sdk";
import { bytesToHex, hexToBytes } from "viem";
import { planDigests } from "@/lib/kasparocket/adapter";
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
  const raw = JSON.parse(JSON.stringify(fixture.plan));
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

const NOW = 1_000_000;
const guardOf = (over: Partial<KaspaRocketGuard> = {}): KaspaRocketGuard => ({
  quote: quoteOf(),
  trade: { tokenId: fixture.tokenId, direction: "buy", amountIn: 100_000_000n },
  lpCovenantId: fixture.lpCovenantId,
  slippageBps: 100n,
  builtAt: NOW,
  now: () => NOW,
  ...over,
});

/** `plan` with every sighash recomputed from its (edited) transaction. */
const resighed = (plan: TransactionPlan): TransactionPlan => {
  const digests = planDigests(plan);
  return {
    ...plan,
    transactions: plan.transactions.map((p, t) => ({
      ...p,
      signingInstructions: p.signingInstructions.map((ins) => {
        const d = digests.find(
          (x) => x.txIndex === t && x.inputIndex === ins.inputIndex,
        );
        return d ? { ...ins, sighash: d.digest } : ins;
      }),
    })),
  };
};

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
    const sig = schnorr.sign(hexToBytes(`0x${digestOf(t, i)}`), hexToBytes(`0x${key}`));
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
  const result = kastleKaspaRocketSigner(sd.fn, fixture.xOnlyPk, guard).signPlan(plan);
  await expect(result).rejects.toThrow(KaspaRocketSignRefusal);
  await expect(result).rejects.toThrow(message);
  expect(sd.calls).toEqual([]);
}

const OTHER_KEY = `000020${"ab".repeat(32)}ac`;

test.describe("kastleKaspaRocketSigner", () => {
  test("places sig65 at scriptP2pkh and it verifies under the wallet key; the pool input is untouched", async () => {
    const plan = planOf();
    const sd = fakeSignDigest(plan);
    const [signed] = await kastleKaspaRocketSigner(sd.fn, fixture.xOnlyPk, guardOf()).signPlan(plan);
    expect(sd.calls).toEqual([[0, 0]]);
    const inputs = signed.inputs as { signatureScript: string; computeBudget: number }[];
    const sig65 = bytesToHex(sd.returned[0]).slice(2);
    expect(inputs[0].signatureScript).toBe(scriptP2pkh(sig65));
    expect(inputs[0].signatureScript).toMatch(/^41[0-9a-f]{128}01$/);
    const [{ digest }] = planDigests(plan);
    expect(schnorr.verify(inputs[0].signatureScript.slice(2, 130), digest, fixture.xOnlyPk)).toBe(true);
    expect(inputs[1].signatureScript).toBe("51");
    expect(inputs[1].computeBudget).toBe(10);
    expect((plan.transactions[0].tx.inputs as any[])[0].signatureScript).toBe("");
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

  test("★ refuses a network fee over 0.1 KAS, and signs one at it", async () => {
    // The fixture pays 9_999_000 sompi; 1_001 sompi less change makes 10_000_001.
    await expectRefused(
      planOf((t) => (t.outputs[2].value = "139998999")),
      guardOf(),
      /network fee 10000001 sompi is over the 10000000 sompi ceiling/,
    );
    const atCeiling = resighed(planOf((t) => (t.outputs[2].value = "139999000")));
    const sd = fakeSignDigest(atCeiling);
    await expect(
      kastleKaspaRocketSigner(sd.fn, fixture.xOnlyPk, guardOf()).signPlan(atCeiling),
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
      kastleKaspaRocketSigner(wrongDigest.fn, fixture.xOnlyPk, guardOf()).signPlan(plan),
    ).rejects.toThrow(/does not verify under the wallet key/);
    const wrongKey = fakeSignDigest(plan, "22".repeat(32));
    await expect(
      kastleKaspaRocketSigner(wrongKey.fn, fixture.xOnlyPk, guardOf()).signPlan(plan),
    ).rejects.toThrow(/does not verify under the wallet key/);
  });

  test("refuses a signature that is not 64 bytes + SIGHASH_ALL", async () => {
    const plan = planOf();
    const sd = fakeSignDigest(plan);
    const noType = async (t: number, i: number) => (await sd.fn(t, i)).slice(0, 64);
    await expect(
      kastleKaspaRocketSigner(noType, fixture.xOnlyPk, guardOf()).signPlan(plan),
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
      expect(await settlePendingKaspaRocket(keyA, async () => outcome)).toBe(outcome);
      expect(await loadPendingKaspaRocket(keyA)).toBeUndefined();
      expect(await claimKaspaRocketPair(keyA)).toBe(true);
      releaseKaspaRocketPair(keyA);
    });
  }

  test("nothing stored settles to undefined", async () => {
    expect(await settlePendingKaspaRocket(keyA, async () => "landed")).toBeUndefined();
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
      expect(await settlePendingKaspaRocket(other, async () => "landed")).toBeUndefined();
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
