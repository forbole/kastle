import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import type { PendingTransaction } from "@/wasm/core/kaspa";
import {
  OPTIMIZE_FEE_THRESHOLD_SOMPI,
  runConsolidation,
  shouldOfferOptimize,
} from "@/lib/consolidate";

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
      transaction: { id: i },
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
  });
});
