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
// Both EVM send screens (ERC-20, and EVM KAS at ?flow=kas) put "Copy logs" on
// the fail screen, its report built from the thrown error.

// kasplexTestnet.rpcUrls.default (lib/layer2 imports SVGs, so not from node).
const RPC = "https://rpc.kasplextest.xyz/";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-erc20-revert-${process.pid}`);
  // vite.build sets NODE_ENV=production in the worker; restore it for the
  // React specs that run after in the same worker.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/erc20-balance-revert/vite.config.mjs"),
      build: { outDir },
    });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
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

// eth_estimateGas answers `answer` (an error, or a gas result so the stubbed
// broadcast runs); returns the fail screen's page.
async function failWith(
  page: Page,
  query: string,
  answer:
    | { error: { code: number; message: string; data?: string } }
    | { result: string },
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          (window as unknown as { __clip: string }).__clip = text;
          return Promise.resolve();
        },
      },
    });
  });
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  };
  await page.route(RPC, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const { id } = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, ...answer }),
    });
  });
  await page.goto(`${base}/?${query}`);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Sorry, Your Majesty.")).toBeVisible();
  expect(errors).toEqual([]);
}

async function copyLogs(page: Page) {
  await page.getByRole("button", { name: "Copy logs" }).click();
  const text = await page.evaluate(
    () => (window as unknown as { __clip?: string }).__clip,
  );
  expect(text).toBeTruthy();
  expect(text).not.toContain("kaspa:");
  expect(text).not.toMatch(/[0-9a-f]{64}/i);
  return JSON.parse(text!) as Record<string, unknown>;
}

const revert = (reason: string) => ({
  error: {
    code: 3,
    message: `execution reverted: ${reason}`,
    data:
      "0x08c379a0" +
      encodeAbiParameters([{ type: "string" }], [reason]).slice(2),
  },
});
// The node's text naming a kaspa address and a 64-hex run: both scrubbed.
const NODE_TEXT = `insufficient funds for gas * price + value: tx ${"cd".repeat(32)} for kaspa:qpz2vgvlxhmyhmt22h538pjzmvvd52nuut80y5zulgpvyerlskvvwm7n4uk0a`;

test("ERC-20 revert: Copy logs carries the revert reason and the RPC code", async ({
  page,
}) => {
  await failWith(page, "", revert("Pausable: paused"));
  const report = await copyLogs(page);
  expect(report.flow).toBe("erc20-send");
  expect(String(report.error) + String(report.cause)).toContain(
    "Pausable: paused",
  );
  expect(report.code).toBe(3);
  expect(report.token).toBe("TKN");
  expect(report.extensionVersion).toBe("9.9.9");
});

test("ERC-20 exceeds-balance revert: the reason shows, and Copy logs too", async ({
  page,
}) => {
  await failWith(page, "", revert("Transfer amount exceeds balance"));
  await expect(
    page.getByText("Transfer amount exceeds balance.", { exact: true }),
  ).toBeVisible();
  const report = await copyLogs(page);
  expect(String(report.error) + String(report.cause)).toContain(
    "Transfer amount exceeds balance",
  );
});

test("ERC-20 node error: Copy logs has the node's text, scrubbed, and -32000", async ({
  page,
}) => {
  await failWith(page, "", { error: { code: -32000, message: NODE_TEXT } });
  const report = await copyLogs(page);
  expect(String(report.error) + String(report.cause)).toContain(
    "insufficient funds for gas",
  );
  expect(report.code).toBe(-32000);
});

test("ERC-20 report fails to scrub: fail screen, no Copy logs", async ({
  page,
}) => {
  await failWith(page, "send=hostile", { result: "0x5208" });
  expect(await page.evaluate(() => window.__erc20.sent)).toBe(1);
  await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(0);
});

test("EVM KAS node error: Copy logs has the node's text, scrubbed, and -32000", async ({
  page,
}) => {
  await failWith(page, "flow=kas", {
    error: { code: -32000, message: NODE_TEXT },
  });
  await expect(page.getByText("The carriage couldn't deliver")).toBeVisible();
  const report = await copyLogs(page);
  expect(report.flow).toBe("evm-kas-send");
  expect(String(report.error) + String(report.cause)).toContain(
    "insufficient funds for gas",
  );
  expect(report.code).toBe(-32000);
  expect(report.chainId).toBe(`0x${(167012).toString(16)}`);
  expect(report.extensionVersion).toBe("9.9.9");
});

test("EVM KAS report fails to scrub: fail screen, no Copy logs", async ({
  page,
}) => {
  await failWith(page, "flow=kas&send=hostile", { result: "0x5208" });
  expect(await page.evaluate(() => window.__erc20.sent)).toBe(1);
  await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(0);
});
