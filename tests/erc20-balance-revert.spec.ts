import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { encodeAbiParameters } from "viem";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real Erc20Send -> ConfirmStep -> FailStatus, built by
// tests/erc20-balance-revert/vite.config.mjs with the hooks, broadcaster and
// Sentry stubbed. viem is real: the chain RPC is answered here, so
// estimateGas throws the same error object it throws in the wallet.
// KASTLE-4J: the token's exceeds-balance revert is shown, not reported; any
// other revert is still reported and gets the generic copy.

// kasplexTestnet.rpcUrls.default (lib/layer2 imports SVGs, so not from node).
const RPC = "https://rpc.kasplextest.xyz/";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-erc20-revert-${process.pid}`);
  await build({
    configFile: path.resolve("tests/erc20-balance-revert/vite.config.mjs"),
    build: { outDir },
  });
  server = http.createServer((req, res) => {
    const p = path.resolve(
      outDir,
      "." + decodeURIComponent((req.url ?? "/").split("?")[0]),
    );
    if (!p.startsWith(outDir + path.sep) && p !== outDir) {
      res.writeHead(403).end();
      return;
    }
    const file =
      existsSync(p) && statSync(p).isFile()
        ? p
        : path.join(outDir, "index.html");
    res.writeHead(200, {
      "content-type":
        { ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ??
        "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

// Every eth_estimateGas reverts with Error(reason), as a node answers it.
async function confirmWithRevert(page: Page, reason: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  };
  const methods: string[] = [];
  await page.route(RPC, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const { id, method } = route.request().postDataJSON();
    methods.push(method);
    const data =
      "0x08c379a0" +
      encodeAbiParameters([{ type: "string" }], [reason]).slice(2);
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: 3, message: `execution reverted: ${reason}`, data },
      }),
    });
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Sorry, Your Majesty.")).toBeVisible();
  expect(errors).toEqual([]);
  expect(methods).toEqual(["eth_estimateGas"]);
  return page.evaluate(() => window.__erc20);
}

test("exceeds-balance revert: not captured, fail screen states it", async ({
  page,
}) => {
  const h = await confirmWithRevert(page, "Transfer amount exceeds balance");
  expect(h.captured).toEqual([]);
  expect(h.sent).toBe(0);
  await expect(
    page.getByText("Transfer amount exceeds balance.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("The carriage couldn't deliver")).toHaveCount(0);
});

test("a different revert is captured and gets the generic fail screen", async ({
  page,
}) => {
  const h = await confirmWithRevert(page, "Pausable: paused");
  expect(h.captured).toHaveLength(1);
  expect(h.captured[0]).toContain("Pausable: paused");
  expect(h.sent).toBe(0);
  await expect(
    page.getByText("The carriage couldn't deliver your TKN this time."),
  ).toBeVisible();
  await expect(page.getByText("Transfer amount exceeds balance.")).toHaveCount(
    0,
  );
});
