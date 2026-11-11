import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real dApp sign confirm screen, built by tests/sign-confirm-covenant/
// with the real WASM and decode; only the wallet, settings and the KCC-20
// pieces fetch are stubbed. The v1 tx is the kaspa.com repro.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-sign-confirm-${process.pid}`);
  // vite.build sets NODE_ENV=production in the worker; restore it for the
  // React specs that run after in the same worker.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/sign-confirm-covenant/vite.config.mjs"),
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
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".wasm": "application/wasm",
        }[path.extname(file)] ?? "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?${query}`);
  await expect(page.getByText("Change to your balance")).toBeVisible();
  return errors;
}

const confirm = (page: Page) => page.getByRole("button", { name: "Confirm" });
const h = (page: Page) => page.evaluate(() => window.__signHarness);
const CAVEAT =
  "Kastle verifies the pieces leaving your wallet. It cannot show the token amounts inside the destination covenant.";

test("v1 spending a wallet piece lists it, with the caveat, and confirms", async ({
  page,
}) => {
  const errors = await open(page, "tx=v1&pieces=a");
  await expect(
    page.getByText("KCC-20 tokens leaving your wallet"),
  ).toBeVisible();
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await expect(page.getByText("-1.25", { exact: true })).toBeVisible();
  // Outputs 0 and 1 are bound to input 0; output 1 is input 0's own P2SH.
  await expect(
    page.getByText(/^To kaspates\.\.\.\w{5}, kaspates/),
  ).toBeVisible();
  await expect(page.getByText(CAVEAT)).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  const harness = await h(page);
  expect(harness.confirmed).toBe(1);
  // The harness stubs the standard-family flag off; the guard scans anyway.
  expect(harness.pieceCalls).toEqual([
    [{ network: "testnet-10", standard: true }],
  ]);
  expect(errors).toEqual([]);
});

test("v1 spending no piece says so in one line and confirms", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=none");
  await expect(
    page.getByText(
      "This request does not move any KCC-20 tokens from your wallet.",
    ),
  ).toBeVisible();
  await expect(page.getByText("KCC-20 tokens leaving your wallet")).toHaveCount(
    0,
  );
  await expect(confirm(page)).toBeEnabled();
});

test("two tokens: two rows, unknown ticker shows the short id and base units", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=ab");
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2c4c9e0f...0dd36", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("-42 base units", { exact: true })).toBeVisible();
});

test("while the decode runs, confirm stays disabled", async ({ page }) => {
  await open(page, "tx=v1&pieces=hang");
  await expect(
    page.getByRole("status").filter({ hasText: "Checking" }),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  await confirm(page).click({ force: true });
  expect((await h(page)).confirmed).toBe(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

test("a failed fetch shows the failure and keeps confirm disabled", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=throw");
  await expect(page.getByRole("alert")).toContainText(
    "could not check which KCC-20 tokens",
  );
  await expect(confirm(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

test("v1 keeps the caller's warning and appends the caveat", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=none&warning=Partial%20outputs");
  await expect(page.getByText(`Partial outputs\n\n${CAVEAT}`)).toBeVisible();
});

test("v0 renders no token section, no caveat and never fetches", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0&pieces=throw");
  await expect(page.getByText(/KCC-20/)).toHaveCount(0);
  await expect(page.getByText(CAVEAT)).toHaveCount(0);
  await expect(confirm(page)).toBeEnabled();
  expect((await h(page)).pieceCalls).toEqual([]);
  expect(errors).toEqual([]);
});
