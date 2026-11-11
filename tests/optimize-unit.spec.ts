import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import type { PendingTransaction } from "@/wasm/core/kaspa";
import type { IUtxoEntry } from "@/wasm/core/kaspa";
import {
  buildRoundReport,
  classifyConsolidation,
  describeRound,
  loadLiveEntries,
  OPTIMIZE_FEE_THRESHOLD_SOMPI,
  runConsolidation,
  shouldOfferOptimize,
} from "@/lib/consolidate";
import { describeTokenOperationError } from "@/lib/token-operation-error";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");

/** Transpiles real component source and evaluates it with `stubs` as its imports. */
function loadModule(file: string, stubs: Record<string, unknown>) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", outputText)(
    (id: string) => stubs[id] ?? {},
    module,
    module.exports,
  );
  return module.exports;
}

const MASS_ERROR = new Error("Storage mass exceeds maximum");

test.describe("optimize prompt visibility", () => {
  test("threshold is 0.1 KAS", () => {
    expect(String(OPTIMIZE_FEE_THRESHOLD_SOMPI)).toBe("10000000");
  });

  test("shown for a mass error, hot wallet and ledger", () => {
    for (const walletType of ["mnemonic", "ledger"]) {
      expect(
        shouldOfferOptimize({
          planError: MASS_ERROR,
          feeSompi: 0n,
          walletType,
        }),
      ).toBe(true);
    }
  });

  test("shown for a fee at or above the threshold", () => {
    expect(
      shouldOfferOptimize({
        planError: undefined,
        feeSompi: OPTIMIZE_FEE_THRESHOLD_SOMPI,
        walletType: "mnemonic",
      }),
    ).toBe(true);
  });

  test("hidden for an ordinary send", () => {
    expect(
      shouldOfferOptimize({
        planError: undefined,
        feeSompi: 2_036n,
        walletType: "mnemonic",
      }),
    ).toBe(false);
  });

  test("hidden for a ledger wallet whose only signal is a high fee", () => {
    expect(
      shouldOfferOptimize({
        planError: undefined,
        feeSompi: OPTIMIZE_FEE_THRESHOLD_SOMPI * 2n,
        walletType: "ledger",
      }),
    ).toBe(false);
  });

  test("hidden for a non-fragmentation plan error", () => {
    expect(
      shouldOfferOptimize({
        planError: new Error("RPC disconnected"),
        feeSompi: OPTIMIZE_FEE_THRESHOLD_SOMPI * 2n,
        walletType: "mnemonic",
      }),
    ).toBe(false);
  });
});

test.describe("optimize confirm state", () => {
  const { OptimizeFundsConfirm } = loadModule(
    "components/screens/full-pages/OptimizeFunds.tsx",
    {
      react: React,
      "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
      "@/wasm/core/kaspa": {
        sompiToKaspaString: (sompi: bigint) => (Number(sompi) / 1e8).toString(),
      },
    },
  );
  const render = (isLedger: boolean) =>
    renderToStaticMarkup(
      React.createElement(OptimizeFundsConfirm, {
        entriesBefore: 11_449,
        entriesAfter: 144,
        transactionCount: 144,
        feeSompi: 2_870_000_000n,
        isLedger,
        canConfirm: true,
        onConfirm: () => {},
      }),
    ) as string;

  test("shows 144 transactions and the entry counts", () => {
    const html = render(false);
    expect(html).toContain("11,449");
    expect(html).toContain(">144<");
    expect(html).toContain("28.7 KAS");
    expect(html).not.toContain("approvals on your Ledger");
  });

  test("ledger wallet shows the approval line", () => {
    expect(render(true)).toContain(
      "144 transactions · 144 approvals on your Ledger",
    );
  });
});

test.describe("optimize run loop", () => {
  const planned = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      transaction: {
        id: i,
        inputs: [{ previousOutpoint: { transactionId: `tx${i}`, index: 0 } }],
      },
      feeAmount: 1_000n,
    })) as unknown as PendingTransaction[];
  const signer = { signTx: async (tx: any) => tx };

  test("calls back once per planned transaction", async () => {
    const calls: number[] = [];
    let signed = 0;
    const result = await runConsolidation(
      planned(5),
      { signTx: async (tx: any) => (signed++, tx) },
      { submitTransaction: async () => ({ transactionId: "id" }) } as any,
      { onTransaction: (p) => calls.push(p.submitted) },
    );
    expect(calls).toEqual([1, 2, 3, 4, 5]);
    expect(signed).toBe(5);
    expect(result.submitted).toBe(5);
    expect(String(result.feePaid)).toBe("5000");
  });

  test("a rejected submit increments rejected and continues", async () => {
    let n = 0;
    const result = await runConsolidation(planned(3), signer, {
      submitTransaction: async () => {
        if (n++ === 1)
          throw new Error("already spent by transaction in the mempool");
        return { transactionId: "id" };
      },
    } as any);
    expect(result.submitted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(String(result.feePaid)).toBe("2000");
    // only submitted inputs are spent; the rejected chunk's stay plannable
    expect(result.spentOutpoints).toEqual(["tx0:0", "tx2:0"]);
    expect(result.cancelled).toBe(false);
  });

  test("a signing failure stops the round", async () => {
    await expect(
      runConsolidation(
        planned(3),
        { signTx: async () => Promise.reject(new Error("rejected on device")) },
        { submitTransaction: async () => ({ transactionId: "id" }) } as any,
      ),
    ).rejects.toThrow("rejected on device");
  });

  test("cancel stops before the next transaction", async () => {
    let calls = 0;
    const result = await runConsolidation(
      planned(4),
      signer,
      { submitTransaction: async () => ({ transactionId: "id" }) } as any,
      { isCanceled: () => calls >= 2, onTransaction: () => calls++ },
    );
    expect(result.submitted).toBe(2);
    expect(result.cancelled).toBe(true);
  });

  test("a cancel pressed during the last transaction is not a cancel", async () => {
    let calls = 0;
    const result = await runConsolidation(
      planned(2),
      signer,
      { submitTransaction: async () => ({ transactionId: "id" }) } as any,
      { isCanceled: () => calls >= 2, onTransaction: () => calls++ },
    );
    expect(result.submitted).toBe(2);
    expect(result.cancelled).toBe(false);
  });
});

test.describe("optimize outcome", () => {
  const outcome = (
    submitted: number,
    rejected: number,
    cancelled = false,
    failed = false,
  ) => classifyConsolidation({ submitted, rejected, cancelled, failed });

  test("success only when submitted, none rejected, not cancelled", () => {
    expect(outcome(144, 0)).toBe("success");
    expect(outcome(1, 0)).toBe("success");
  });

  test("zero submitted is never success", () => {
    for (const rejected of [0, 1, 144]) {
      for (const cancelled of [false, true]) {
        for (const failed of [false, true]) {
          expect(outcome(0, rejected, cancelled, failed)).not.toBe("success");
        }
      }
    }
  });

  test("partial rejection is incomplete", () => {
    expect(outcome(1, 143)).toBe("incomplete");
    expect(outcome(0, 144)).toBe("incomplete");
  });

  test("a cancel or a signing failure after a submit is incomplete", () => {
    expect(outcome(3, 0, true)).toBe("incomplete");
    expect(outcome(3, 0, false, true)).toBe("incomplete");
    expect(outcome(0, 0, false, true)).toBe("incomplete");
  });

  test("a cancel before the first submit is cancelled-early", () => {
    expect(outcome(0, 0, true)).toBe("cancelled-early");
  });
});

test.describe("optimize retry entries", () => {
  const entry = (transactionId: string, index = 0) =>
    ({ outpoint: { transactionId, index } }) as unknown as IUtxoEntry;

  test("plans from the revalidated set, minus inputs already submitted", async () => {
    const cached = [entry("spent-a"), entry("spent-b"), entry("kept")];
    let revalidations = 0;
    const live = await loadLiveEntries(async () => {
      revalidations++;
      // the node no longer lists spent-a; spent-b is still unaccepted
      return [entry("spent-b"), entry("kept"), entry("fresh")];
    }, ["spent-a:0", "spent-b:0"]);
    expect(revalidations).toBe(1);
    expect(live.map((e) => e.outpoint.transactionId)).toEqual([
      "kept",
      "fresh",
    ]);
    expect(live).not.toContain(cached[0]);
  });
});

test.describe("optimize ledger connect step", () => {
  const render = (ledgerSigner: unknown) => {
    const { default: OptimizeFunds } = loadModule(
      "components/screens/full-pages/OptimizeFunds.tsx",
      {
        react: React,
        "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
        "react-router-dom": {
          useNavigate: () => () => {},
          useLocation: () => ({ state: null }),
        },
        "@/wasm/core/kaspa": { sompiToKaspaString: String },
        "@/lib/consolidate": { classifyConsolidation, loadLiveEntries },
        "@/hooks/useKasFeeEstimate": {
          useUtxoEntries: () => ({ mutate: async () => [] }),
        },
        "@/hooks/useRpcClientStateful": () => ({
          rpcClient: {},
          networkId: "mainnet",
          isConnected: true,
        }),
        "@/hooks/wallet/useWalletManager": () => ({
          wallet: { type: "ledger" },
          account: { address: "kaspa:qtest" },
        }),
        "@/hooks/wallet/useKaspaHotWalletSigner": () => ({ signTx: () => {} }),
        "@/hooks/wallet/useKaspaLedgerSigner": () => ledgerSigner,
        "@/components/screens/ledger-connect/LedgerConnectForSign": () =>
          React.createElement("div", { "data-testid": "ledger-connect" }),
        "@/components/GeneralHeader.tsx": () => null,
        "@/assets/images/carriage.png": "carriage.png",
      },
    );
    return renderToStaticMarkup(React.createElement(OptimizeFunds)) as string;
  };

  test("a ledger wallet without a signer shows the connect step", () => {
    const html = render(undefined);
    expect(html).toContain('data-testid="ledger-connect"');
    expect(html).not.toContain("Optimize</button>");
  });

  test("a connected ledger skips the connect step", () => {
    expect(render({ signTx: () => {} })).not.toContain("ledger-connect");
  });
});

test.describe("optimize diagnostics", () => {
  const planned = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      transaction: {
        id: i,
        inputs: [{ previousOutpoint: { transactionId: `tx${i}`, index: 0 } }],
      },
      feeAmount: 1_000n,
    })) as unknown as PendingTransaction[];
  const signer = { signTx: async (tx: any) => tx };

  test("a first rejection carries the node's reason and stops the round", async () => {
    let submits = 0;
    const result = await runConsolidation(planned(144), signer, {
      submitTransaction: async () => {
        submits++;
        throw new Error("transaction mass 101234 exceeds the standard limit");
      },
    } as any);
    expect(submits).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.submitted).toBe(0);
    expect(result.lastError).toContain("exceeds the standard limit");
  });

  test("a round that landed one transaction keeps going after a rejection", async () => {
    let n = 0;
    const result = await runConsolidation(planned(4), signer, {
      submitTransaction: async () => {
        if (n++ === 1) throw new Error("orphan");
        return { transactionId: "id" };
      },
    } as any);
    expect(n).toBe(4);
    expect(result.submitted).toBe(3);
    expect(result.rejected).toBe(1);
    expect(result.lastError).toBe("Error: orphan");
  });

  test("a dropped socket is caught before the first submit", async () => {
    let submits = 0;
    let connects = 0;
    await expect(
      runConsolidation(planned(3), signer, {
        isConnected: false,
        connect: async () => {
          connects++;
          throw new Error("WebSocket closed");
        },
        submitTransaction: async () => (submits++, { transactionId: "id" }),
      } as any),
    ).rejects.toThrow(
      "the node connection dropped before the round could start",
    );
    expect(connects).toBe(1);
    expect(submits).toBe(0);
  });

  test("summary counts transactions, not UTXOs", () => {
    expect(
      describeRound({ submitted: 0, rejected: 144, total: 144, feePaid: "0" }),
    ).toBe("0 of 144 transactions sent · all 144 rejected · nothing paid");
    expect(
      describeRound({
        submitted: 97,
        rejected: 47,
        total: 144,
        feePaid: "8.73",
      }),
    ).toBe("97 of 144 transactions sent · 47 rejected · fee paid 8.73 KAS");
  });

  test("failure screen shows the reason and copies a scrubbed report", () => {
    const txid = "a".repeat(64);
    const address =
      "kaspa:qpamkvhgh0kzx50gwvvp5xs8ktmqutcy3dfs9dc3w7lm9rq0zs76vf959mmrp";
    const reason = `transaction ${txid} input ${txid}:0 of ${address} is already spent`;
    const report = buildRoundReport({
      extensionVersion: "2.62.1",
      networkId: "mainnet",
      rpcUrl: "wss://node.example/kaspa",
      walletType: "hot",
      total: 144,
      submitted: 0,
      rejected: 1,
      feePaid: "0",
      lastError: reason,
    });
    const copied: string[] = [];
    const { TokenOperationFailed } = loadModule(
      "components/screens/full-pages/TokenOperationFailed.tsx",
      {
        react: React,
        "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
        "react-router-dom": { useNavigate: () => () => {} },
        "react-router": {
          useLocation: () => ({
            state: {
              op: "optimize",
              submitted: 0,
              rejected: 1,
              total: 144,
              feePaid: "0",
              lastError: report.lastError,
              report,
            },
          }),
        },
        "@/hooks/kasplex/useTokenInfo": { useTokenInfo: () => ({}) },
        "@/lib/krc20.ts": { applyDecimal: () => ({ toFloat: Number }) },
        "@/hooks/useExtensionUtils.ts": () => ({}),
        "@/lib/token-operation-error": { describeTokenOperationError },
        "@/lib/consolidate": { describeRound },
        "@/components/dashboard/ClipboardCopy": ({
          textToCopy,
          children,
        }: any) => {
          copied.push(textToCopy);
          return React.createElement("div", null, children);
        },
        "@/components/GeneralHeader": () => null,
        "@/assets/images/fail.png": "fail.png",
      },
    );
    const html = renderToStaticMarkup(
      React.createElement(TokenOperationFailed),
    ) as string;
    expect(html).toContain(
      "0 of 144 transactions sent · 1 rejected · nothing paid",
    );
    expect(html).toContain("is already spent");
    expect(html).toContain("Copy report");
    expect(copied).toHaveLength(1);
    expect(JSON.parse(copied[0]).rejected).toBe(1);
    expect(copied[0]).toContain("is already spent");
    expect(copied[0]).not.toMatch(/[0-9a-fA-F]{64}/);
    expect(copied[0]).not.toContain("kaspa:q");
    expect(html).not.toMatch(/[0-9a-fA-F]{64}/);
  });
});
