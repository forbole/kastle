import { expect, test } from "@playwright/test";
import type { BuiltTx, FundingUtxo, SubmitState } from "@kassealhq/sdk";
import type { KassealToken, KassealTxStatus } from "@/lib/kasseal/api";
import type {
  KassealBuilder,
  KassealIntent,
  KassealSubmissionDeps,
} from "@/lib/kasseal/trade";
import { kassealRoutable } from "@/lib/kasseal/market";
import { kassealPopupWallet } from "@/lib/kasseal/popupWallet";
import {
  KASSEAL_PENDING_COPY,
  kassealTradeKey,
  loadKassealAttempt,
  settlePendingKasseal,
  submitPersistedKassealTrade,
} from "@/lib/kasseal/pending";
import { LEGACY_KASSEAL_ATTEMPTS_KEY } from "@/lib/kasseal/legacy-cleanup";
import { l1PendingCopy } from "@/hooks/swap/l1Types";

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

const coin = (txid: string, index = 0) =>
  ({ outpoint: { txid, index } }) as unknown as FundingUtxo;

const fakeBuilt = (txid: string, funding: string) =>
  ({
    txid,
    txJson: "{}",
    consumes: [{ txid: funding, index: 0 }],
    inputsToSign: [],
    budgets: [],
    produces: [],
    feeSompi: 2_000n,
    feerate: 1n,
  }) as unknown as BuiltTx;

/** A popup's deps: each build funds from fresh coin f<n> unless pinned. */
function popupDeps(
  run: string,
  post: (built: BuiltTx) => Promise<SubmitState>,
  status: (txid: string) => Promise<KassealTxStatus>,
) {
  let t = 0;
  let builds = 0;
  const requiredSeen: string[][] = [];
  const deps: KassealSubmissionDeps = {
    makeBuilder: (required) => {
      requiredSeen.push([...(required ?? [])]);
      const fresh = coin(`f${builds + 1}`);
      return {
        builder: {} as KassealBuilder,
        lastFunding: () =>
          required ? [...required].map((k) => coin(k.split(":")[0])) : [fresh],
      };
    },
    build: async () => {
      builds += 1;
      const pinned = requiredSeen[requiredSeen.length - 1][0];
      return fakeBuilt(
        `${run}${builds}`,
        pinned?.split(":")[0] ?? `f${builds}`,
      );
    },
    sign: async (built) => built,
    post,
    status,
    now: () => (t += 1_000),
    sleepUntil: async (until) => {
      t = Math.max(t, until);
    },
    pollMs: 0,
  };
  return { deps, requiredSeen };
}

const KEY = kassealTradeKey("testnet-10", "kaspatest:qme", "cov1");
const BUY: KassealIntent = {
  side: "buy",
  venue: "curve",
  amount: 100n,
  input: "1",
};

const token = (covenantId: string, phase: KassealToken["phase"]) =>
  ({ covenantId, phase }) as KassealToken;

test.describe("Kasseal swap plumbing", () => {
  test("listing: curve tokens from useKassealTokens' data, undefined while unknown", () => {
    expect(kassealRoutable(undefined)).toBeUndefined();
    const set = kassealRoutable([
      token("a", "bonding"),
      token("b", "graduated"),
    ]);
    expect([...(set ?? [])]).toEqual(["a"]);
    expect(kassealRoutable([])?.size).toBe(0);
  });

  test("popup wallet passes signInputDigest/signTx through and adds nothing", () => {
    const signInputDigest = async () => new Uint8Array(65);
    const signTx = async (tx: any) => tx;
    const signer = { signInputDigest, signTx, signMessage: async () => "x" };
    const wallet = kassealPopupWallet(signer);
    expect(Object.keys(wallet).sort()).toEqual(["signInputDigest", "signTx"]);
    expect(wallet.signInputDigest).toBe(signInputDigest);
    expect(wallet.signTx).toBe(signTx);
  });

  test("the attempt is stored before the POST; a reload retries on its pinned coins", async () => {
    const data = stubStorage();
    expect(KEY.startsWith(LEGACY_KASSEAL_ATTEMPTS_KEY)).toBe(false);
    const atPost: any[] = [];
    const closed = popupDeps(
      "a",
      async (built) => {
        atPost.push({ txid: built.txid, stored: structuredClone(data[KEY]) });
        throw new TypeError("Failed to fetch"); // the popup closes here
      },
      async () => ({ kind: "unknown" }),
    );
    const first = await submitPersistedKassealTrade(
      closed.deps,
      KEY,
      BUY,
    ).catch((e) => e);
    expect(first.code).toBe("outcome-unknown");
    // Every POST finds its own txid already stored, with the first coins.
    expect(atPost[0]).toEqual({
      txid: "a1",
      stored: {
        pinned: ["f1:0"],
        posted: ["a1"],
        intent: { ...BUY, amount: "100" },
      },
    });
    for (const p of atPost) {
      expect(p.stored.posted).toContain(p.txid);
      expect(p.stored.pinned).toEqual(["f1:0"]);
    }

    // Reopened popup: no attempt in memory, new deps whose fresh coin is f1
    // of their own; only storage knows the first trade's coins.
    const reopened = popupDeps(
      "b",
      async (built) => ({ kind: "submitted", txid: built.txid, at: 0 }),
      async (txid) =>
        txid.startsWith("a")
          ? { kind: "unknown" }
          : { kind: "accepted", txid, acceptingBlueScore: 3 },
    );
    expect(await submitPersistedKassealTrade(reopened.deps, KEY, BUY)).toBe(
      "b1",
    );
    expect(reopened.requiredSeen).toEqual([["f1:0"]]);
    // Landed: terminal, so the key is gone.
    expect(KEY in data).toBe(false);
  });

  test("a stored attempt for another amount refuses without building", async () => {
    stubStorage();
    const closed = popupDeps(
      "a",
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => ({ kind: "unknown" }),
    );
    await submitPersistedKassealTrade(closed.deps, KEY, BUY).catch(() => {});
    const other = popupDeps(
      "b",
      async (built) => ({ kind: "submitted", txid: built.txid, at: 0 }),
      async () => ({ kind: "unknown" }),
    );
    const e = await submitPersistedKassealTrade(other.deps, KEY, {
      ...BUY,
      amount: 200n,
    }).catch((err) => err);
    expect(e.message).toBe(KASSEAL_PENDING_COPY);
    expect(other.requiredSeen).toEqual([]);
    expect((await loadKassealAttempt(KEY))?.posted[0]).toBe("a1");
  });

  test("on load a stored attempt stays pending until /tx says it cannot land", async () => {
    const data = stubStorage();
    data[KEY] = {
      pinned: ["f1:0"],
      posted: ["a1"],
      intent: { ...BUY, amount: "100" },
    };
    expect(
      await settlePendingKasseal(KEY, async () => ({ kind: "unknown" })),
    ).toBe("open");
    expect(KEY in data).toBe(true);
    expect(
      await settlePendingKasseal(
        KEY,
        async () => ({ kind: "dropped" }) as KassealTxStatus,
      ),
    ).toBe("not-sent");
    expect(KEY in data).toBe(false);
    expect(
      await settlePendingKasseal(KEY, async () => ({ kind: "unknown" })),
    ).toBe(undefined);
  });

  test("pendingCopy absent reads Braid's copy", () => {
    expect(l1PendingCopy({})).toBe(
      "A Braid swap for this pair is still settling.",
    );
    expect(l1PendingCopy({ pendingCopy: "x" })).toBe("x");
  });
});
