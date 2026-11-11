import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The real handlers, real covenant guard and real decode; only the background
// ApiUtils (storage, popup window, RPC) and the pieces fetcher are stubbed.
type Guard = {
  popups: string[];
  pieceCalls: unknown[][];
  pieces: (...args: unknown[]) => Promise<unknown[]>;
};
const guard: Guard = {
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
      getCurrentAccount: async () => ({
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
registerHooks({
  load: (url, ctx, next) => {
    const stub = Object.entries(STUBS).find(([end]) => url.endsWith(end));
    return stub
      ? { format: "module", source: stub[1], shortCircuit: true }
      : next(url, ctx);
  },
});

const { default: init, Transaction } = await import("@/wasm/core/kaspa");
const { RPC_ERRORS } = await import("@/api/message");
const { signTxHandler } = await import(
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
): Promise<{ id: string; response: unknown; error?: unknown }> =>
  new Promise((resolve) =>
    handler(
      1,
      {
        id: "req-1",
        host: "https://kron.example",
        payload: { networkId: NETWORK, txJson },
      } as any,
      resolve,
    ),
  );

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
      expect(res.error).toEqual(RPC_ERRORS.COVENANT_TX_UNDECODABLE);
    });

    test("version 1 that decodes opens the popup with the request only", async () => {
      guard.pieces = async () => [
        {
          outpoint: {
            transactionId:
              "c95be92b71d2858ec179cd7f021c09022d226dc63ebf882eafaa07422e096990",
            index: 0,
          },
          covenantId:
            "ae3a6563b6374dc14c2b1bcd399c38a157f97c5a215ec26d0c33dfeaff91e5b8",
          family: "kron-legacy",
          amount: 1n,
          symbol: "",
        },
      ];
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
  });
}
