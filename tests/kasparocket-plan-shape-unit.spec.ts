import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import {
  parseAmounts,
  type ProtocolInfo,
  type TransactionPlan,
} from "@kasparocket/sdk";
import {
  KaspaRocketTxFormatError,
  kasparocketPlanToTx,
  planDigests,
} from "@/lib/kasparocket/adapter";
import { kaspaRocketPlanNetworkFee } from "@/lib/kasparocket/fees";
import {
  KaspaRocketSignRefusal,
  kaspaRocketCheckPayees,
  kaspaRocketPlanPayout,
  type KaspaRocketGuard,
} from "@/lib/kasparocket/signer";

// REAL: a server-built /pro-api/plan/trade buy (FOUR for 160 KAS), its
// server-prepared sighashes, and the vendor's /protocol document, all from
// 2026-11-26. No network, no signing, no broadcast.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const real = load("kasparocket-plan.trade-buy-FOUR.real.json");
const prepared = load("kasparocket-plan.trade-buy-FOUR.sighashes.real.json")
  .signingInstructions as { inputIndex: number; sighash: string }[];
const protocolDoc = load("kasparocket-protocol.real.json")
  .protocol as ProtocolInfo;

const BOUGHT = "5298975";
// Inputs less outputs of the real transaction: the network fee it pays.
const REAL_NETWORK_FEE = "18658300";
// Keys no fixture names: an address neither the wallet's, the pool's, nor
// either protocol fee address.
const STRANGER = "ab".repeat(32);
const OTHER_WALLET = "cd".repeat(32);
const p2pk = (k: string) => ({ version: 0, script: `20${k}ac` });

/**
 * The real plan as the SDK hands it to the app (`parseAmounts`: summary
 * amounts become bigints, `tx` left as the server sent it), optionally edited
 * first on the raw JSON.
 */
function planOf(edit?: (plan: any) => void): TransactionPlan {
  const raw = JSON.parse(JSON.stringify(real.plan));
  edit?.(raw);
  return parseAmounts(raw) as TransactionPlan;
}
const txOf = (p: any) => p.transactions[0].tx;
const protocolOf = (edit?: (p: any) => void): ProtocolInfo => {
  const p = JSON.parse(JSON.stringify(protocolDoc));
  edit?.(p);
  return p;
};

const guard = {
  trade: { tokenId: real.tokenId, direction: "buy", amountIn: 16_000_000_000n },
  lpCovenantId: real.lpCovenantId,
} as unknown as KaspaRocketGuard;

const payees =
  (
    plan: TransactionPlan,
    protocol: ProtocolInfo = protocolOf(),
    pk: string = real.xOnlyPk,
  ) =>
  () =>
    kaspaRocketCheckPayees(plan, guard, pk, protocol);
const REFUSED = "plan pays an address this wallet cannot spend";

test.describe("kasparocketPlanToTx, the server's real shape", () => {
  test("★ reads the real plan's transaction without throwing", () => {
    const tx = kasparocketPlanToTx(txOf(planOf()));
    expect(tx.inputs).toHaveLength(8);
    expect(tx.outputs).toHaveLength(6);
    // previousOutpoint object → Outpoint.
    expect(tx.inputs[0].previousOutpoint).toEqual({
      transactionId:
        "e79eeffec389b003516b4643f3ae788f7fc1b15c4143558e699a05aca56f01c9",
      index: 1,
    });
    // `{ version, script }` → script and version, coin and output alike.
    expect(tx.inputs[2].utxo!.scriptPublicKey).toBe(`20${real.xOnlyPk}ac`);
    expect(tx.inputs[2].utxo!.scriptVersion).toBe(0);
    expect(tx.outputs[5].scriptPublicKey).toBe(
      "2011d969764b5fc2f687d50acb3c9faeb68975ff7a1a1e0e454b81377890417c6eac",
    );
    // utxo.covenantId carried on covenant coins, absent on plain ones.
    expect(tx.inputs[0].utxo!.covenantId).toBe(real.lpCovenantId);
    expect(tx.inputs[1].utxo!.covenantId).toBe(real.tokenId);
    expect(tx.inputs[2].utxo!.covenantId).toBeUndefined();
  });

  test("★ every recomputed digest equals the server's prepared sighash", () => {
    const plan = planOf();
    const withPrepared = {
      ...plan,
      transactions: [
        {
          ...plan.transactions[0],
          signingInstructions: prepared.map((i) => ({ ...i, kind: "p2pkh" })),
        },
      ],
    } as unknown as TransactionPlan;
    const digests = planDigests(withPrepared);
    expect(digests).toHaveLength(6);
    for (const d of digests) {
      expect(d.digest, `input ${d.inputIndex}`).toBe(d.prepared);
    }
  });

  test("still refuses what it does not know, in the server's shape", () => {
    const cases: [string, (p: any) => void][] = [
      ["unknown transaction key", (p) => (txOf(p).fee = "1")],
      ["unknown input key", (p) => (txOf(p).inputs[2].witness = "")],
      ["unknown coin key", (p) => (txOf(p).inputs[2].utxo.extra = 1)],
      ["unknown output key", (p) => (txOf(p).outputs[0].memo = "x")],
      ["storageMass not a u64", (p) => (txOf(p).storageMass = "-1")],
      [
        "both outpoint forms",
        (p) => {
          const i = txOf(p).inputs[2];
          Object.assign(i, i.previousOutpoint);
        },
      ],
      ["no outpoint", (p) => delete txOf(p).inputs[2].previousOutpoint],
      [
        "previousOutpoint with a short txid",
        (p) => (txOf(p).inputs[2].previousOutpoint.transactionId = "00"),
      ],
      [
        "coin names another outpoint",
        (p) => (txOf(p).inputs[2].utxo.outpoint.index += 1),
      ],
      [
        "coin covenantId not 32-byte hex",
        (p) => (txOf(p).inputs[0].utxo.covenantId = "510c"),
      ],
      [
        "scriptPublicKey object with an extra key",
        (p) => (txOf(p).outputs[0].scriptPublicKey.extra = 1),
      ],
      [
        "scriptPublicKey version not an integer",
        (p) => (txOf(p).outputs[0].scriptPublicKey.version = "0"),
      ],
      [
        "scriptPublicKey script not hex",
        (p) => (txOf(p).outputs[0].scriptPublicKey.script = "zz"),
      ],
      [
        "scriptPublicKey empty script",
        (p) => (txOf(p).inputs[2].utxo.scriptPublicKey.script = ""),
      ],
    ];
    for (const [name, edit] of cases) {
      expect(() => kasparocketPlanToTx(txOf(planOf(edit))), name).toThrow(
        KaspaRocketTxFormatError,
      );
    }
  });
});

test.describe("kaspaRocketPlanNetworkFee, real plan", () => {
  test("★ is the inputs less the outputs: 18658300 sompi", () => {
    // String(): a failing bigint expect crash-loops the Playwright worker.
    expect(String(kaspaRocketPlanNetworkFee(planOf()))).toBe(REAL_NETWORK_FEE);
  });
});

test.describe("kaspaRocketPlanPayout, real plan, after the adapter fix", () => {
  test("★ still 5298975", () => {
    expect(
      String(
        kaspaRocketPlanPayout(planOf(), real.tokenId, real.xOnlyPk, "buy"),
      ),
    ).toBe(BOUGHT);
  });
});

test.describe("checkPayees, real plan", () => {
  test("★ passes the real plan", () => {
    expect(payees(planOf())).not.toThrow();
  });

  test("★ the treasury output passes only on protocol().treasuryAddress", () => {
    expect(
      payees(
        planOf(),
        protocolOf((p) => delete p.treasuryAddress),
      ),
    ).toThrow(REFUSED);
    // Another valid mainnet address in its place.
    expect(
      payees(
        planOf(),
        protocolOf((p) => (p.treasuryAddress = p.partner.feeAddress)),
      ),
    ).toThrow(REFUSED);
  });

  test("★ the partner output passes on protocol().partner.feeAddress, when it is not the wallet", () => {
    // In the real plan the wallet is the partner fee address; move the change
    // to another wallet so output 0 passes on the partner rule alone.
    const plan = planOf(
      (p) => (txOf(p).outputs[1].scriptPublicKey = p2pk(OTHER_WALLET)),
    );
    expect(payees(plan, protocolOf(), OTHER_WALLET)).not.toThrow();
    expect(
      payees(
        plan,
        protocolOf((p) => (p.partner = null)),
        OTHER_WALLET,
      ),
    ).toThrow(REFUSED);
    // The partner index pointing elsewhere leaves output 0 unlisted.
    const moved = planOf((p) => {
      txOf(p).outputs[1].scriptPublicKey = p2pk(OTHER_WALLET);
      p.summary.outputs.partnerFee = 1;
    });
    expect(payees(moved, protocolOf(), OTHER_WALLET)).toThrow(REFUSED);
  });

  test("★ refuses an output added to an unlisted address", () => {
    const plan = planOf((p) =>
      txOf(p).outputs.push({
        value: "100000000",
        scriptPublicKey: p2pk(STRANGER),
        covenant: null,
      }),
    );
    expect(payees(plan)).toThrow(KaspaRocketSignRefusal);
    expect(payees(plan)).toThrow(REFUSED);
  });

  test("★ refuses kcc20User moved to an output with another covenant", () => {
    // kcc20User now names output 2, the pool vault: output 4, the token cell,
    // is at no named index any more.
    expect(payees(planOf((p) => (p.summary.outputs.kcc20User = 2)))).toThrow(
      REFUSED,
    );
    // And the named output 4 carrying a covenant that is not the token's.
    expect(
      payees(
        planOf((p) => (txOf(p).outputs[4].covenant.covenantId = STRANGER)),
      ),
    ).toThrow(REFUSED);
  });

  test("★ refuses the fee index on a plain output to a random key", () => {
    // Output 5 keeps its index and amount but pays a stranger.
    expect(
      payees(
        planOf((p) => (txOf(p).outputs[5].scriptPublicKey = p2pk(STRANGER))),
      ),
    ).toThrow(REFUSED);
    // The fee index moved off output 5 leaves the treasury output unlisted.
    expect(payees(planOf((p) => (p.summary.outputs.fee = 1)))).toThrow(REFUSED);
  });

  test("refuses the rest of what the list does not name", () => {
    const cases: [string, (p: any) => void][] = [
      // A named token cell on a plain key instead of a P2SH.
      [
        "kcc20User cell on a stranger's key",
        (p) => (txOf(p).outputs[4].scriptPublicKey = p2pk(STRANGER)),
      ],
      [
        "kcc20Reserve cell on a stranger's key",
        (p) => (txOf(p).outputs[3].scriptPublicKey = p2pk(STRANGER)),
      ],
      // The token's reserve cell at no named index.
      ["no kcc20Reserve index", (p) => delete p.summary.outputs.kcc20Reserve],
      ["kcc20User index a string", (p) => (p.summary.outputs.kcc20User = "4")],
      // The treasury paid other than the summary's fee.
      [
        "treasury over the fee",
        (p) => (txOf(p).outputs[5].value = "200000001"),
      ],
      ["no platformFeeSompi", (p) => delete p.summary.platformFeeSompi],
      // A covenant on the fee output.
      [
        "fee output under a covenant",
        (p) =>
          (txOf(p).outputs[5].covenant = {
            authorizingInput: 0,
            covenantId: STRANGER,
          }),
      ],
      // The treasury's key behind script version 1.
      [
        "fee script version 1",
        (p) => (txOf(p).outputs[5].scriptPublicKey.version = 1),
      ],
    ];
    for (const [name, edit] of cases) {
      expect(payees(planOf(edit)), name).toThrow(REFUSED);
    }
  });
});
