import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";

const root = process.cwd();
const pageDir = path.join(root, "devtools/zkas-test");

function runTestPage(memo: string) {
  const calls: { method: string; args: unknown }[] = [];
  const nodes = new Map<string, Record<string, unknown>>();
  for (const id of [
    "origin",
    "provider",
    "recipient",
    "amount",
    "fee",
    "memo",
    "memo-help",
    "probe",
    "connect",
    "account",
    "balance",
    "send",
    "connection-output",
    "read-output",
    "send-output",
  ]) {
    nodes.set(id, {
      value: "",
      textContent: "",
      classList: { toggle: () => undefined },
      addEventListener(_event: string, listener: () => void) {
        this[_event] = listener;
      },
    });
  }
  nodes.get("recipient")!.value = "zkas:recipient";
  nodes.get("amount")!.value = "1.25";
  nodes.get("fee")!.value = "0.03";
  nodes.get("memo")!.value = memo;
  const source = fs.readFileSync(path.join(pageDir, "test.js"), "utf8");
  runInNewContext(source, {
    document: { getElementById: (id: string) => nodes.get(id) },
    window: {
      location: { origin: "http://localhost:4173" },
      kastle: {
        request: async (method: string, args: unknown) => {
          calls.push({ method, args });
          return { pending: true };
        },
      },
      addEventListener: () => undefined,
    },
    TextEncoder,
    TextDecoder,
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 1,
  });
  return { calls, nodes };
}

test("local payment page sends the exact optional memo through the website API", () => {
  const html = fs.readFileSync(path.join(pageDir, "index.html"), "utf8");
  expect(html).toMatch(/<textarea\b[^>]*id="memo"/);
  const { calls, nodes } = runTestPage("  invoice 42\n");
  (nodes.get("send")!.click as () => void)();
  expect(calls).toEqual([
    {
      method: "zkas:send",
      args: {
        to: "zkas:recipient",
        amountSompi: "125000000",
        maxFeeSompi: "3000000",
        memo: "  invoice 42\n",
      },
    },
  ]);
});

test("local payment page blocks oversized memos before requesting approval", () => {
  const { calls, nodes } = runTestPage("😀".repeat(129));
  (nodes.get("memo")!.input as () => void)();
  expect(nodes.get("memo-help")!.textContent).toMatch(/^516\/512 UTF-8 bytes/);
  (nodes.get("send")!.click as () => void)();
  expect(calls).toEqual([]);
  expect(nodes.get("send-output")!.textContent).toMatch(/512 UTF-8 bytes/);
});

test("local payment page omits an empty memo", () => {
  const { calls, nodes } = runTestPage("");
  (nodes.get("send")!.click as () => void)();
  expect(calls[0]?.args).toEqual({
    to: "zkas:recipient",
    amountSompi: "125000000",
    maxFeeSompi: "3000000",
  });
});
