import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { KaspaRocketError, type TransactionPlan } from "@kasparocket/sdk";
import {
  KaspaRocketTxFormatError,
  kasparocketPlanToTx,
  planDigests,
} from "@/lib/kasparocket/adapter";
import * as client from "@/lib/kasparocket/client";
import { rocketConfigured } from "@/lib/kasparocket/config";
import {
  kaspaRocketFeeLine,
  kaspaRocketFeesOf,
  kaspaRocketMinOrderError,
  kaspaRocketNetworkFeeLine,
  kaspaRocketPlanFeeLine,
  kaspaRocketProtocolKey,
} from "@/lib/kasparocket/fees";

// SYNTHETIC: a hand-built v1 pool buy, its sighash frozen from @dotk/sdk-tx
// (the same fixture mobile's adapter tests use).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/kasparocket-plan.synthetic.json"),
    "utf8",
  ),
);

/** A fresh copy of the fixture plan, its transaction edited by `edit`. */
function planOf(
  edit?: (tx: any) => void,
  summary: Record<string, unknown> = {},
): TransactionPlan {
  const raw = JSON.parse(JSON.stringify(fixture.plan));
  edit?.(raw.transactions[0].tx);
  return {
    ...raw,
    summary: { ...raw.summary, kasFlowSompi: 100_000_000n, ...summary },
  };
}

const KAS = 100_000_000n;

/** Swaps global fetch for `handler`, counting calls; restore() puts it back. */
function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const real = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = real) };
}

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

/** The listing module, evaluated with `rocketConfigured()` answering `configured`. */
function loadListing(configured: boolean) {
  const source = fs.readFileSync(
    path.join(__dirname, "../hooks/swap/kasparocketListing.ts"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const stubs: Record<string, unknown> = {
    react: nodeRequire("react"),
    swr: nodeRequire("swr"),
    "@/contexts/SettingsContext": {
      NetworkType: { Mainnet: "mainnet", TestnetT10: "testnet-10" },
    },
    "@/lib/kasparocket/client": client,
    "@/lib/kasparocket/config": { rocketConfigured: () => configured },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", outputText)(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`unexpected runtime import ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
  );
  return module.exports as typeof import("@/hooks/swap/kasparocketListing");
}

test.describe("adapter", () => {
  test("reads the plan's transaction, covenants included", () => {
    const tx = kasparocketPlanToTx(planOf().transactions[0].tx);
    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs[0].covenant?.covenantId).toBe(fixture.lpCovenantId);
  });

  for (const [where, edit] of [
    // storageMass and utxo.covenantId are read now (the server sends them):
    // kasparocket-plan-shape-unit.spec.ts. Unknown keys still refuse.
    ["transaction", (t: any) => (t.verboseData = null)],
    ["input", (t: any) => (t.inputs[0].verboseData = null)],
    ["coin", (t: any) => (t.inputs[0].utxo.verboseData = null)],
    ["output", (t: any) => (t.outputs[0].verboseData = null)],
    ["covenant", (t: any) => (t.outputs[0].covenant.extra = 1)],
  ] as const) {
    test(`refuses an unknown field on the ${where}`, () => {
      const tx = planOf(edit).transactions[0].tx;
      expect(() => kasparocketPlanToTx(tx)).toThrow(KaspaRocketTxFormatError);
      expect(() => kasparocketPlanToTx(tx)).toThrow(/unknown field/);
    });
  }

  test("refuses more than 10 inputs", () => {
    const tx = planOf((t) => {
      t.inputs = Array.from({ length: 11 }, () => t.inputs[0]);
    }).transactions[0].tx;
    expect(() => kasparocketPlanToTx(tx)).toThrow(/11 inputs, more than 10/);
  });

  test("planDigests: one v1 SIGHASH_ALL digest per instruction, equal to the frozen vector", () => {
    expect(planDigests(planOf())).toEqual([
      {
        txIndex: 0,
        inputIndex: 0,
        digest:
          "52aec815148881db1fd07859a67f2756b4fb4fb450b4587801c47b92728d6bd9",
        prepared:
          "52aec815148881db1fd07859a67f2756b4fb4fb450b4587801c47b92728d6bd9",
      },
    ]);
  });

  test("planDigests commits to the output covenants", () => {
    const [moved] = planDigests(
      planOf((t) => (t.outputs[0].covenant.authorizingInput = 0)),
    );
    expect(moved.digest).not.toBe(
      "52aec815148881db1fd07859a67f2756b4fb4fb450b4587801c47b92728d6bd9",
    );
  });
});

test.describe("fees", () => {
  // KaspaRocket's live schedule as protocol() states it (JSON-safe).
  const PROTOCOL = {
    fees: {
      treasuryRate: 0.01,
      treasuryMinSompi: "200000000",
      partnerRate: 0.005,
      partnerMinSompi: "100000000",
    },
    limits: { minOrderValueSompi: "15000000000" },
    token: { decimals: 8 },
  };
  const FEES = kaspaRocketFeesOf(PROTOCOL)!;

  test("a schedule missing any figure is unknown, never guessed", () => {
    expect(FEES).toBeDefined();
    expect(kaspaRocketFeesOf({ ...PROTOCOL, limits: {} })).toBeUndefined();
    expect(kaspaRocketFeesOf(undefined)).toBeUndefined();
  });

  test("the 150 KAS floor blocks below it, not at it", () => {
    expect(kaspaRocketMinOrderError(150n * KAS - 1n, FEES)).toBe(
      "KaspaRocket's minimum trade is 150 KAS.",
    );
    expect(kaspaRocketMinOrderError(150n * KAS, FEES)).toBeUndefined();
    // No verdict before protocol() loads.
    expect(kaspaRocketMinOrderError(1n * KAS, undefined)).toBeUndefined();
  });

  test("the KaspaRocket line: 1.5% of the KAS traded, at least 3 KAS", () => {
    // 100 KAS: 1 % and 0.5 % fall under their 2 and 1 KAS floors.
    expect(kaspaRocketFeeLine(100n * KAS, FEES)).toEqual({
      name: "KaspaRocket",
      symbol: "KAS",
      amount: 3,
      display: "3 KAS",
      hint: "1.5% of the KAS traded, at least 3 KAS",
    });
    // 1000 KAS: 10 + 5, above both floors.
    expect(kaspaRocketFeeLine(1000n * KAS, FEES)?.amount).toBe(15);
    expect(kaspaRocketFeeLine(100n * KAS, undefined)).toBeUndefined();
    expect(kaspaRocketFeeLine(undefined, FEES)).toBeUndefined();
  });

  test("the network line is the plan's inputs less its outputs; unreadable → no line", () => {
    // 2.5 + 1000 KAS in, 1001 + 0.00001 + 1.4 KAS out.
    expect(kaspaRocketNetworkFeeLine(planOf())).toEqual({
      name: "Network",
      symbol: "KAS",
      amount: 0.09999,
      display: "0.09999 KAS",
      hint: "Set by the swap KaspaRocket built",
    });
    expect(
      kaspaRocketNetworkFeeLine(planOf((t) => (t.extra = 1))),
    ).toBeUndefined();
    expect(kaspaRocketNetworkFeeLine(undefined)).toBeUndefined();
  });

  test("the plan's own fee line reads its summary; absent when it states none", () => {
    const plan = planOf(undefined, { totalPlatformFeeSompi: 3n * KAS });
    expect(kaspaRocketPlanFeeLine(plan, "hint")).toMatchObject({
      amount: 3,
      display: "3 KAS",
      hint: "hint",
    });
    expect(kaspaRocketPlanFeeLine(planOf(), "hint")).toBeUndefined();
  });
});

test.describe("empty proxy token", () => {
  test("this build has none: not configured, no protocol key", () => {
    expect(rocketConfigured()).toBe(false);
    expect(kaspaRocketProtocolKey(true)).toBeNull();
  });

  test("the client sends nothing, from protocol or the catalogue", async () => {
    const f = stubFetch(() => json({}));
    try {
      for (const kr of [
        client.makeKaspaRocket(),
        client.makeKaspaRocket({ apiKey: "" }),
      ]) {
        await expect(kr.protocol()).rejects.toThrow(/not configured/);
        await expect(kr.catalogue.poolCovenant("a")).rejects.toThrow(
          /not configured/,
        );
      }
      expect(f.calls).toHaveLength(0);
    } finally {
      f.restore();
    }
  });

  test("the listing has no key, so it never probes", () => {
    const off = loadListing(false);
    expect(off.kaspaRocketListingKey("mainnet", true, ["a"])).toBeNull();
  });
});

test.describe("client", () => {
  test("goes to the proxy with the app-side token", async () => {
    const f = stubFetch(() =>
      json([{ utxo_type: "amm", lp_amm_covenant_id: "pool" }]),
    );
    try {
      const kr = client.makeKaspaRocket({
        apiKey: "t",
        baseUrl: "https://proxy.test/",
      });
      expect(await kr.catalogue.poolCovenant("abc")).toMatchObject({
        lp_amm_covenant_id: "pool",
      });
      expect(f.calls.map((c) => c.url)).toEqual([
        "https://proxy.test/api/covenants/by-token/abc",
      ]);
      const headers = f.calls[0].init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer t");
    } finally {
      f.restore();
    }
  });

  test("shows the server's words only for a refused request", () => {
    const say = (kind: string) =>
      client.kaspaRocketErrorCopy(
        new KaspaRocketError(kind as never, "server says"),
        "fallback",
      );
    expect(say("invalid_request")).toBe("server says");
    expect(say("conflict")).toBe("server says");
    expect(say("unsupported")).toBe("server says");
    expect(say("network")).toBe("fallback");
    expect(say("rate_limited")).toBe("fallback");
    expect(client.kaspaRocketErrorCopy(new Error("x"), "fallback")).toBe(
      "fallback",
    );
  });
});

test.describe("listing", () => {
  const kr = () =>
    client.makeKaspaRocket({ apiKey: "t", baseUrl: "https://p" });
  const idOf = (url: string) => url.split("/").pop()!;

  test("mainnet only, and only while enabled", () => {
    const on = loadListing(true);
    expect(on.kaspaRocketListingKey("mainnet", true, ["a", "b"])).toEqual([
      "kasparocketPools",
      "a,b",
    ]);
    expect(on.kaspaRocketListingKey("testnet-10", true, ["a"])).toBeNull();
    expect(on.kaspaRocketListingKey("mainnet", false, ["a"])).toBeNull();
  });

  test("a token with a null pool is absent from the set", async () => {
    const l = loadListing(true);
    l.clearKaspaRocketPools();
    const f = stubFetch((url) =>
      json(
        idOf(url) === "pooled"
          ? [{ utxo_type: "amm", lp_amm_covenant_id: "lp" }]
          : [],
      ),
    );
    try {
      const probed = await l.probeKaspaRocketListing(
        kr(),
        ["pooled", "bare"],
        "bare",
      );
      expect(probed.get("bare")).toBeNull();
      expect(Array.from(l.kaspaRocketRoutable(probed, "bare")!)).toEqual([
        "pooled",
      ]);
    } finally {
      f.restore();
    }
  });

  test("an unanswered probe leaves the listing undefined", async () => {
    const l = loadListing(true);
    l.clearKaspaRocketPools();
    const f = stubFetch(() => Promise.reject(new TypeError("offline")));
    try {
      await expect(
        l.probeKaspaRocketListing(kr(), ["sel"], "sel"),
      ).rejects.toThrow(/probe failed/);
      expect(l.kaspaRocketRoutable(undefined, "sel")).toBeUndefined();
      // Held tokens answered, the selected one not: still unknown.
      expect(
        l.kaspaRocketRoutable(new Map([["held", "lp"]]), "sel"),
      ).toBeUndefined();
    } finally {
      f.restore();
    }
  });

  test("at most 5 probes in flight; answers held for 10 minutes", async () => {
    const l = loadListing(true);
    l.clearKaspaRocketPools();
    expect(l.KASPAROCKET_PROBES_IN_FLIGHT).toBe(5);
    expect(l.KASPAROCKET_POOL_TTL_MS).toBe(10 * 60_000);
    let open = 0;
    let peak = 0;
    const f = stubFetch(async () => {
      peak = Math.max(peak, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return json([]);
    });
    const now = Date.now;
    try {
      const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
      await l.probeKaspaRocketListing(kr(), ids, undefined);
      expect(f.calls).toHaveLength(12);
      expect(peak).toBe(5);
      // Within the TTL: no new request.
      await l.probeKaspaRocketListing(kr(), ids, undefined);
      expect(f.calls).toHaveLength(12);
      // Past it: asked again.
      const t0 = now();
      Date.now = () => t0 + l.KASPAROCKET_POOL_TTL_MS;
      await l.probeKaspaRocketListing(kr(), ["t0"], undefined);
      expect(f.calls).toHaveLength(13);
    } finally {
      Date.now = now;
      f.restore();
    }
  });
});
