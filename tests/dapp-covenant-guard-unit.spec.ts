import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The real handlers, real covenant guard and real decode; only the background
// ApiUtils (storage, popup window, RPC) and the pieces fetcher are stubbed.
type Guard = {
  wallet: { id: string; type: string };
  popups: string[];
  pieceCalls: unknown[][];
  pieces: (...args: unknown[]) => Promise<unknown[]>;
};
const guard: Guard = {
  wallet: { id: "w1", type: "mnemonic" },
  popups: [],
  pieceCalls: [],
  pieces: async () => [],
};
(globalThis as any).__covenantGuard = guard;
// The handlers read the extension's `browser` global. Other spec files share
// this worker and swap it too, so set it per test (not at load) and restore.
const realBrowser = (globalThis as any).browser;
test.beforeEach(() => {
  (globalThis as any).browser = {
    runtime: { getURL: (p: string) => `chrome-extension://kastle${p}` },
  };
});
test.afterAll(() => {
  (globalThis as any).browser = realBrowser;
});

const STUBS: Record<string, string> = {
  "/api/background/utils.ts": `
    const g = () => globalThis.__covenantGuard;
    export const ApiUtils = {
      isInitialized: async () => true,
      isHostConnected: async () => true,
      createApiResponse: (id, response, error) => ({ id, response, error }),
      openPopupAndListenForResponse: async (id, url) => {
        g().popups.push(url);
        return { id, response: "popup-answer" };
      },
      getCurrentWallet: async () => g().wallet,
      getCurrentAccount: async () => ({
        index: 0,
        address: "kaspatest:qqvy0kf7yf2dzz0cmsaaf7gdt9nn6dh7ykvztdn9cev5wm0jp6dgv26v7c7mv",
      }),
      getSettings: async () => ({ networkId: "testnet-10" }),
      connectKaspaRpcClient: async () => ({ disconnect: async () => {} }),
    };`,
  "/lib/kcc20/wallet-pieces.ts": `
    export const walletKcc20Pieces = (...args) => {
      globalThis.__covenantGuard.pieceCalls.push(args);
      return globalThis.__covenantGuard.pieces(...args);
    };`,
};
// Hooks are process-wide and specs share a worker: stub only what the handlers
// import, under its own URL, so other specs still load the real modules
// (wallet-pieces-unit.spec.ts tests the real walletKcc20Pieces).
const MARK = "?covenant-guard-stub";
registerHooks({
  resolve: (specifier, ctx, next) => {
    const r = next(specifier, ctx);
    return ctx.parentURL?.includes("/api/background/handlers/") &&
      Object.keys(STUBS).some((end) => r.url.endsWith(end))
      ? { ...r, url: r.url + MARK }
      : r;
  },
  load: (url, ctx, next) => {
    const stub =
      url.endsWith(MARK) &&
      Object.entries(STUBS).find(([end]) =>
        url.slice(0, -MARK.length).endsWith(end),
      );
    return stub
      ? { format: "module", source: stub[1], shortCircuit: true }
      : next(url, ctx);
  },
});

const { default: init, Transaction } = await import("@/wasm/core/kaspa");
const { RPC_ERRORS } = await import("@/api/message");
const { admissionRefusal } = await import(
  "@/api/background/handlers/kaspa/utils"
);
const { CovenantScanRefusal, LEDGER_FOREIGN_INPUT } = await import(
  "@/lib/kcc20/dapp-request"
);
const { signTxHandler, signPsktHandler } = await import(
  "@/api/background/handlers/kaspa/signTx"
);
const { signAndBroadcastTxHandler } = await import(
  "@/api/background/handlers/kaspa/signAndBroadcastTx"
);

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(
  path.join(TESTS_DIR, "../test/fixtures/kaspacom-signtx-repro.txt"),
  "utf8",
);
const [, NETWORK, V1_TX_JSON] = raw.match(/signTx\(\s*'([^']+)',\s*'(.*?)',/s)!;

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

test.beforeEach(() => {
  guard.wallet = { id: "w1", type: "mnemonic" };
  guard.popups = [];
  guard.pieceCalls = [];
  guard.pieces = async () => [];
});

const v0TxJson = () => {
  const tx = new Transaction({
    version: 0,
    inputs: [],
    outputs: [],
    lockTime: 0n,
    subnetworkId: "0000000000000000000000000000000000000000",
    gas: 0n,
    payload: "",
  });
  return tx.serializeToSafeJSON();
};

const HANDLERS = [
  ["signTx", signTxHandler],
  ["signAndBroadcastTx", signAndBroadcastTxHandler],
] as const;

const call = (
  handler: (typeof HANDLERS)[number][1],
  txJson: string,
  scripts?: unknown[],
  extra: Record<string, unknown> = {},
): Promise<{ id: string; response: unknown; error?: unknown }> =>
  new Promise((resolve) =>
    handler(
      1,
      {
        id: "req-1",
        host: "https://kron.example",
        payload: { networkId: NETWORK, txJson, scripts, ...extra },
      } as any,
      resolve,
    ),
  );

// The repro's piece A (input 0); input 1 is piece B, input 2 the wallet's coin.
const PIECE_A = {
  outpoint: {
    transactionId:
      "c95be92b71d2858ec179cd7f021c09022d226dc63ebf882eafaa07422e096990",
    index: 0,
  },
  covenantId:
    "ae3a6563b6374dc14c2b1bcd399c38a157f97c5a215ec26d0c33dfeaff91e5b8",
  family: "kron-legacy",
  amount: 1n,
  value: 100_000_000n,
  symbol: "",
};

for (const [name, handler] of HANDLERS) {
  test.describe(`${name} covenant guard`, () => {
    test("version 0 opens the popup and never fetches pieces", async () => {
      const txJson = v0TxJson();
      expect(JSON.parse(txJson).version).toBe(0);
      const res = await call(handler, txJson);
      expect(guard.pieceCalls).toHaveLength(0);
      expect(guard.popups).toHaveLength(1);
      expect(res.response).toBe("popup-answer");
    });

    test("version 1 with a failing pieces fetch is refused, no popup", async () => {
      guard.pieces = async () => {
        throw new Error("indexer down");
      };
      const res = await call(handler, V1_TX_JSON);
      expect(guard.pieceCalls).toHaveLength(1);
      expect(guard.popups).toHaveLength(0);
      expect(res.response).toBeNull();
      // An outage reads as one, not as a bad request.
      expect(res.error).toEqual({
        code: RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
        message: "Kastle could not read your tokens — try again",
      });
    });

    test("version 1 that decodes opens the popup with the request only", async () => {
      guard.pieces = async () => [PIECE_A];
      const res = await call(handler, V1_TX_JSON);
      expect(guard.pieceCalls).toHaveLength(1);
      // Standard pieces always scanned: the flag gates display, not the guard.
      expect(guard.pieceCalls[0][2]).toEqual({
        network: "testnet-10",
        standard: true,
      });
      expect(guard.popups).toHaveLength(1);
      const url = new URL(guard.popups[0]);
      expect([...url.searchParams.keys()].sort()).toEqual([
        "origin",
        "payload",
        "requestId",
      ]);
      expect(res.response).toBe("popup-answer");
    });

    test("version 1 that scripts a token state the wallet cannot check is refused", async () => {
      guard.pieces = async () => [PIECE_A];
      const res = await call(handler, V1_TX_JSON, [
        { inputIndex: 1, signType: "All" },
      ]);
      expect(guard.popups).toHaveLength(0);
      expect(res.response).toBeNull();
      const error = res.error as { code: number; message: string };
      expect(error.code).toBe(RPC_ERRORS.COVENANT_TX_UNDECODABLE.code);
      expect(error.message).toContain("input 1 spends a token state");
      expect(error.message).toContain(
        "Kastle cannot check standard KCC-20 tokens on testnet-10",
      );
    });

    test("version 1 that scripts only the wallet's own coin opens the popup", async () => {
      guard.pieces = async () => [PIECE_A];
      const res = await call(handler, V1_TX_JSON, [
        { inputIndex: 2, signType: "All" },
      ]);
      expect(guard.popups).toHaveLength(1);
      expect(res.response).toBe("popup-answer");
    });

    test("an admission is bound to the account it ran for; another account refuses at confirm", async () => {
      guard.pieces = async () => [PIECE_A];
      // A dApp cannot plant a binding: overwritten for v1, dropped for v0.
      await call(handler, V1_TX_JSON, undefined, { admittedFor: "w9:9" });
      await call(handler, v0TxJson(), undefined, { admittedFor: "w9:9" });
      const [v1, v0] = guard.popups.map((u) =>
        JSON.parse(new URL(u).searchParams.get("payload")!),
      );
      expect(v1.admittedFor).toBe("w1:0");
      expect(v0.admittedFor).toBeUndefined();
      // The popup's check before wallet.signTx.
      expect(admissionRefusal(v1, "w1", 0)).toBeUndefined();
      expect(admissionRefusal(v1, "w2", 0)).toEqual(
        RPC_ERRORS.COVENANT_ACCOUNT_CHANGED,
      );
      expect(admissionRefusal(v1, "w1", 1)).toEqual(
        RPC_ERRORS.COVENANT_ACCOUNT_CHANGED,
      );
      expect(admissionRefusal(v1, undefined, undefined)).toEqual(
        RPC_ERRORS.COVENANT_ACCOUNT_CHANGED,
      );
      expect(admissionRefusal(v0, "w2", 3)).toBeUndefined();
      expect(RPC_ERRORS.COVENANT_ACCOUNT_CHANGED.code).not.toBe(
        RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
      );
    });

    test("a foreign input refuses on a Ledger account and opens for a hot wallet", async () => {
      // Input 1 (piece B) is not held and not scripted: skipped for a hot wallet.
      guard.pieces = async () => [PIECE_A];
      const hot = await call(handler, V1_TX_JSON);
      expect(hot.response).toBe("popup-answer");
      guard.wallet = { id: "w1", type: "ledger" };
      for (const scripts of [undefined, [{ inputIndex: 1, signType: "All" }]]) {
        const res = await call(handler, V1_TX_JSON, scripts);
        expect(res.response).toBeNull();
        const error = res.error as { code: number; message: string };
        expect(error.code).toBe(RPC_ERRORS.COVENANT_TX_UNDECODABLE.code);
        expect(error.message).toContain(LEDGER_FOREIGN_INPUT);
      }
      expect(guard.popups).toHaveLength(1);
    });

    test("a scan refusal keeps its own message, never the retry one", async () => {
      guard.pieces = async () => {
        throw new CovenantScanRefusal("You hold more than 50 KCC-20 tokens");
      };
      const res = await call(handler, V1_TX_JSON);
      expect(guard.popups).toHaveLength(0);
      expect(res.error).toEqual({
        code: RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
        message: "You hold more than 50 KCC-20 tokens.",
      });
    });

    test("a malformed sign option is refused, no popup", async () => {
      guard.pieces = async () => [PIECE_A];
      const res = await call(handler, V1_TX_JSON, [{ inputIndex: -1 }]);
      expect(guard.popups).toHaveLength(0);
      expect(res.error).toEqual(RPC_ERRORS.COVENANT_TX_UNDECODABLE);
    });
  });
}

// The repro's input 1: piece B, a covenant UTXO the wallet does not hold the address of.
const PIECE_B = {
  ...PIECE_A,
  outpoint: {
    transactionId:
      "e5aa2289b808367ec116640e98e9e9618ecb434f681750c387cfba4276df55b2",
    index: 2,
  },
  covenantId:
    "2c4c9e0f46a412391b26499b2f23a14c3d3a965624deafc11d72c5200340dd36",
};

const callPskt = (
  txJsonString: string,
  signInputs?: unknown[],
): Promise<{ id: string; response: unknown; error?: unknown }> =>
  new Promise((resolve) =>
    signPsktHandler(
      1,
      {
        id: "req-pskt",
        host: "https://kron.example",
        payload: { txJsonString, options: { signInputs } },
      } as any,
      resolve,
    ),
  );

const popupPayload = (url: string) =>
  JSON.parse(new URL(url).searchParams.get("payload")!);

test.describe("signPskt account binding", () => {
  test("a version-0 signPskt is bound to its account and refuses another; a version-0 signTx is not", async () => {
    await callPskt(v0TxJson());
    await call(signTxHandler, v0TxJson(), undefined, { admittedFor: "w9:9" });
    const [pskt, tx] = guard.popups;
    // signPskt: bound to the account its hole check ran for, refused for another.
    expect(popupPayload(pskt).admittedFor).toBe("w1:0");
    expect(admissionRefusal(popupPayload(pskt), "w2", 0)).toEqual(
      RPC_ERRORS.COVENANT_ACCOUNT_CHANGED,
    );
    // signTx: unchanged, unbound, never refused on a switch.
    expect(popupPayload(tx).admittedFor).toBeUndefined();
    expect(admissionRefusal(popupPayload(tx), "w2", 0)).toBeUndefined();
    // Only the background names the method; signTx carries none.
    expect(new URL(pskt).searchParams.get("method")).toBe("signPskt");
    expect(new URL(tx).searchParams.get("method")).toBeNull();
  });

  test("a version-1 signPskt opens bound to the account the admission ran for", async () => {
    guard.pieces = async () => [PIECE_A, PIECE_B];
    const res = await callPskt(V1_TX_JSON, [{ index: 1 }, { index: 2 }]);
    expect(res.response).toBe("popup-answer");
    expect(popupPayload(guard.popups[0]).admittedFor).toBe("w1:0");
  });

  test("an account switch between the hole check and the admission refuses, no popup", async () => {
    guard.pieces = async () => [PIECE_A, PIECE_B];
    // First read (signPskt's hole check) sees w1, every later one w2.
    let reads = 0;
    Object.defineProperty(guard, "wallet", {
      configurable: true,
      get: () => ({ id: reads++ === 0 ? "w1" : "w2", type: "mnemonic" }),
    });
    try {
      const res = await callPskt(V1_TX_JSON, [{ index: 1 }, { index: 2 }]);
      expect(res.error).toEqual(RPC_ERRORS.COVENANT_ACCOUNT_CHANGED);
      expect(guard.popups).toHaveLength(0);
    } finally {
      Object.defineProperty(guard, "wallet", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: { id: "w1", type: "mnemonic" },
      });
    }
  });
});
