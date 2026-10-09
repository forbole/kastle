import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

if (process.env.DIRECT_SCREEN_CHROME)
  test.use({ launchOptions: { executablePath: process.env.DIRECT_SCREEN_CHROME } });

const approvalId = "11111111-2222-4333-8444-555555555555";
const cardHex = "ee".repeat(184);
const fingerprint = createHash("sha256")
  .update(Buffer.from(cardHex, "hex"))
  .digest("hex");
const facts = {
  kind: "text", actionId: "aa".repeat(16), text: "Full message <keep literal> with a second line\nfor review",
  decision: null, referenceActionId: "bb".repeat(16),
  ownerPeerId: "cc".repeat(16), recipientPeerId: "dd".repeat(16),
  recipientCardHex: cardHex, accountAddress: "zkas:" + "a".repeat(79),
  daemonOrigin: "https://wallet.example",
  outputs: [
    { role: "peer", recipient: "zkas:" + "b".repeat(79), amountSompi: "1" },
    { role: "cache", recipient: "zkas:" + "c".repeat(79), amountSompi: "1" },
    { role: "archive", recipient: "zkas:" + "d".repeat(79), amountSompi: "1" },
    { role: "collector", recipient: "zkas:" + "e".repeat(79), amountSompi: "10000000" },
  ],
  explicitTotalSompi: "10000003", maxNetworkFeeSompi: "5000000", maximumTotalSompi: "15000003",
};

async function screenBundle(): Promise<string> {
  const component = resolve("components/screens/browser-api/zkas/ZKasDirectAction.tsx");
  const result = await build({
    stdin: {
      contents: `import React from "react";
        import { createRoot } from "react-dom/client";
        import DirectAction from ${JSON.stringify(component)};
        createRoot(document.getElementById("root")!).render(React.createElement(DirectAction));`,
      resolveDir: process.cwd(), sourcefile: "direct-screen-entry.tsx", loader: "tsx",
    },
    bundle: true, format: "iife", platform: "browser", write: false,
    plugins: [{ name: "popup-boundary", setup(plugin) {
      plugin.onResolve({ filter: /^@\/components\/GeneralHeader$/ }, () => ({ path: "header", namespace: "direct-mock" }));
      plugin.onResolve({ filter: /^@\/lib\/service\/methods$/ }, () => ({ path: "methods", namespace: "direct-mock" }));
      plugin.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: "utils", namespace: "direct-mock" }));
      plugin.onLoad({ filter: /.*/, namespace: "direct-mock" }, ({ path }) => ({
        contents: path === "header" ? "export default function Header(){return null;}" :
          path === "methods" ? "export const Method={ZKAS_DIRECT_ACTION_PENDING_GET:'PENDING',ZKAS_DIRECT_ACTION_COMPLETE:'COMPLETE'};" :
          "export async function sendMessage(method,data){globalThis.__requests.push({method,data});return method==='PENDING'?globalThis.__pending:globalThis.__result;}",
        loader: "js", resolveDir: process.cwd(),
      }));
    } }],
  });
  return result.outputFiles[0].text;
}

async function mount(page: Page, bundle: string, result: unknown) {
  await page.route("https://wallet.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto(`https://wallet.test/popup.html?approvalId=${approvalId}`);
  await page.evaluate(({ pending, result }) => Object.assign(window, { __pending: pending, __result: result, __requests: [] }),
    { pending: { origin: "https://messages.example", facts }, result });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByText("Recipient card SHA-256:", { exact: false })).toBeVisible();
}

test("the rendered popup discloses full text, card fingerprint, four recipients and exact fee bounds", async ({ page }) => {
  const bundle = await screenBundle();
  await mount(page, bundle, { state: "pending", delivered: true });
  await expect(page.getByText(facts.text)).toBeVisible();
  await expect(page.getByText(fingerprint, { exact: false })).toBeVisible();
  for (const output of facts.outputs) {
    await expect(page.getByText(`${output.role}: ${output.amountSompi} sompi to ${output.recipient}`)).toBeVisible();
  }
  await expect(page.getByText("Collector service fee: 10,000,000 sompi (0.1 ZKAS).")).toBeVisible();
  await expect(page.getByText("Network fee ceiling: 5000000 sompi (0.05 ZKAS).")).toBeVisible();
  await expect(page.getByText("Maximum total: 15000003 sompi (0.15000003 ZKAS).")).toBeVisible();
  await page.getByRole("button", { name: "Approve and pay" }).click();
  await expect(page.getByText("Approval sent to the website.")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__requests"))).toEqual([
    { method: "PENDING", data: { approvalId } },
    { method: "COMPLETE", data: { approvalId, decision: "approve" } },
  ]);
  await expect(page.getByRole("button", { name: "Approve and pay" })).toHaveCount(0);
});

test("the rendered denial reports cancellation without approval", async ({ page }) => {
  const bundle = await screenBundle();
  await mount(page, bundle, { state: "failed" });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Request cancelled before approval.")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__requests"))).toEqual([
    { method: "PENDING", data: { approvalId } },
    { method: "COMPLETE", data: { approvalId, decision: "deny" } },
  ]);
});
