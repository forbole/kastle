import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { KASSEAL_LABELS } from "@/ui/popup/kasseal/labels";

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

const baseStubs = {
  react: React,
  "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
  "./labels": { KASSEAL_LABELS },
};

const QuoteSummary = loadModule(
  "ui/popup/kasseal/QuoteSummary.tsx",
  baseStubs,
).default;

test.describe("Kasseal QuoteSummary bound label", () => {
  const row = (side: "buy" | "sell", boundKind: string) =>
    renderToStaticMarkup(
      React.createElement(QuoteSummary, {
        side,
        boundKind,
        pay: "100 KAS",
        receive: "1,000 SEAL",
        bound: "990 SEAL",
        fee: "1 KAS",
        slippage: "1%",
      }),
    );

  test("a pool buy's bound is a minimum received, not a max paid", () => {
    const html = row("buy", "min-received");
    expect(html).toContain(KASSEAL_LABELS.minReceived);
    expect(html).not.toContain(KASSEAL_LABELS.maxPaid);
  });

  test("a curve buy's bound is a max paid", () => {
    const html = row("buy", "max-paid");
    expect(html).toContain(KASSEAL_LABELS.maxPaid);
    expect(html).not.toContain(KASSEAL_LABELS.minReceived);
  });
});

const SettingsContext = {
  NetworkType: { Mainnet: "mainnet", TestnetT10: "testnet-10" },
  KASSEAL_API_URLS: { mainnet: "https://k" },
};

test.describe("Kasseal token response", () => {
  const api = loadModule("lib/kasseal/api.ts", {
    "@/contexts/SettingsContext.tsx": SettingsContext,
  });
  const respond = (covenantId: string) =>
    (async () =>
      new Response(
        JSON.stringify({ meta: { covenantId, ticker: "B" }, supply: {} }),
        { status: 200 },
      )) as unknown as typeof fetch;

  test("a response for another covenant is rejected", async () => {
    let err: unknown;
    await api
      .fetchKassealToken("https://k", "A", respond("B"))
      .catch((e: unknown) => {
        err = e;
      });
    expect(String(err)).toContain("token response is for B, not A");
  });

  test("a response for the requested covenant is returned", async () => {
    const token = await api.fetchKassealToken("https://k", "A", respond("A"));
    expect(token.covenantId).toBe("A");
  });
});
