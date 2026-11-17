import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real OptimizeFunds page, built by tests/optimize-funds/vite.config.mjs:
// real lib/consolidate and WASM, stub wallet / RPC / signer / UTXO hooks.
// Query: account=A|B, signer=A|B|none, index, legacy=1, ledger=1. Account A
// holds 200 entries (3 transactions), B 250 (4 transactions).

const ALREADY_FIT = "already fit in a single transaction";
const MISMATCH = "signing key does not match";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-optimize-funds-${process.pid}`);
  await build({
    configFile: path.resolve("tests/optimize-funds/vite.config.mjs"),
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
  return errors;
}

const calls = (page: Page) =>
  page.evaluate(() => window.__optimize.state().calls);
const failed = (page: Page) =>
  page.evaluate(() => window.__optimize.state().failed);
const optimizeBtn = (page: Page) =>
  page.getByRole("button", { name: "Optimize", exact: true });

test("signer owns the account: the confirm panel is shown", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=A");
  await expect(optimizeBtn(page)).toBeEnabled();
  await expect(page.getByText("Entries before")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await calls(page)).getAddress).toBe(1);
  expect(errors).toEqual([]);
});

test("signer owns the account: Optimize signs and submits every planned transaction", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=A");
  const txRow = page
    .locator("span", { hasText: /^Transactions$/ })
    .locator("..");
  // A's 200 entries plan 3 transactions
  await expect(txRow).toContainText("3");
  await optimizeBtn(page).click();
  await expect(page.getByText("Optimize succeeded stub")).toBeVisible();
  const c = await calls(page);
  // once while planning, once by runConsolidation on the signing object
  expect(c.getAddress).toBe(2);
  expect(c.signTx).toBe(3);
  expect(c.submit).toBe(3);
  expect(await page.evaluate(() => window.__optimize.state().succeeded)).toBe(
    true,
  );
  expect(await failed(page)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("signer key differs from the account: error shown, never 'already fit'", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=B");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(MISMATCH);
  await expect(alert).toContainText("Nothing was signed or sent");
  await expect(alert).toHaveClass(/text-red-500/);
  await expect(alert).not.toContainText("kaspa:");
  await expect(page.getByText(ALREADY_FIT)).toHaveCount(0);
  await expect(optimizeBtn(page)).toHaveCount(0);
  const c = await calls(page);
  // refused before the entries were even planned
  expect(c.revalidate).toBe(0);
  expect(c.signTx).toBe(0);
  expect(c.submit).toBe(0);
  expect(errors).toEqual([]);
});

test("getAddress failure: error shown, never 'already fit'", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=fail");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Could not read the signing key's address");
  await expect(alert).toHaveClass(/text-red-500/);
  await expect(page.getByText(ALREADY_FIT)).toHaveCount(0);
  await expect(optimizeBtn(page)).toHaveCount(0);
  const c = await calls(page);
  expect(c.revalidate).toBe(0);
  expect(c.signTx).toBe(0);
  expect(errors).toEqual([]);
});

test("getAddress failure: Retry plans again once the signer recovers", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=fail");
  await expect(page.getByRole("alert")).toContainText(
    "Could not read the signing key's address",
  );
  await expect(optimizeBtn(page)).toHaveCount(0);
  // the harness keeps one signer object: nothing but Retry can re-plan
  await page.evaluate(() => window.__optimize.update({ signerFails: false }));
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(optimizeBtn(page)).toBeEnabled();
  await expect(page.getByText("Entries before")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("legacy toggle after planning: Optimize signs nothing and reports the mismatch", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=A&index=1");
  await expect(optimizeBtn(page)).toBeEnabled();
  // the toggle changes the signer's key, not the account address
  await page.evaluate(() => {
    const { addresses, update } = window.__optimize;
    update({ signerAddress: addresses.B, isLegacy: true });
  });
  await optimizeBtn(page).click();
  await expect(page.getByText("Optimize failed stub")).toBeVisible();
  const c = await calls(page);
  expect(c.signTx).toBe(0);
  expect(c.submit).toBe(0);
  const f = await failed(page);
  expect(f?.errorName).toBe("SignerMismatchError");
  expect(f?.report?.signerMatchesPlan).toBe(false);
  expect(f?.report?.accountIndex).toBe(1);
  expect(f?.report?.isLegacy).toBe(true);
  expect(f?.report?.walletType).toBe("hot");
  expect(JSON.stringify(f?.report)).not.toContain("kaspa:");
  expect(errors).toEqual([]);
});

test("account switch to an address the signer does not own: re-plans, refuses, signs nothing", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=A");
  await expect(optimizeBtn(page)).toBeEnabled();
  await page.evaluate(() => {
    const { addresses, update } = window.__optimize;
    update({ accountAddress: addresses.B });
  });
  await expect(page.getByRole("alert")).toContainText(MISMATCH);
  await expect(optimizeBtn(page)).toHaveCount(0);
  await expect(page.getByText(ALREADY_FIT)).toHaveCount(0);
  const c = await calls(page);
  expect(c.getAddress).toBe(2);
  expect(c.signTx).toBe(0);
  expect(c.submit).toBe(0);
  expect(errors).toEqual([]);
});

test("account switch with the signer following: the page re-plans for the new address", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=A");
  await expect(page.getByText("Transactions")).toBeVisible();
  const txRow = page
    .locator("span", { hasText: /^Transactions$/ })
    .locator("..");
  await expect(txRow).toContainText("3");
  await page.evaluate(() => {
    const { addresses, update } = window.__optimize;
    update({ accountAddress: addresses.B, signerAddress: addresses.B });
  });
  // B's 250 entries plan 4 transactions: the plan is no longer A's
  await expect(txRow).toContainText("4");
  expect((await calls(page)).revalidate).toBe(2);
  expect(errors).toEqual([]);
});

test("Ledger not connected: plans without the early check, shows the connect step", async ({
  page,
}) => {
  const errors = await open(page, "account=A&signer=none&ledger=1");
  await expect(page.getByTestId("ledger-connect")).toBeVisible();
  await expect.poll(async () => (await calls(page)).revalidate).toBe(1);
  // connecting a device whose key is not A's: the round is refused before signing
  await page.evaluate(() => {
    const { addresses, update } = window.__optimize;
    update({ signerAddress: addresses.B });
  });
  await optimizeBtn(page).click();
  await expect(page.getByText("Optimize failed stub")).toBeVisible();
  const c = await calls(page);
  expect(c.signTx).toBe(0);
  expect(c.submit).toBe(0);
  expect((await failed(page))?.report?.walletType).toBe("ledger");
  expect(errors).toEqual([]);
});
