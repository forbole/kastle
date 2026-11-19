import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real OptimizeFunds page with the real useKaspaHotWalletSigner: only its
// background signer is a stub, backed by both derivations of one recovery
// phrase (tests/optimize-funds/vite.config.mjs, mode "real-signer").
// Account L is the legacy key of account 1 and holds 81 entries (1
// transaction); B is a key the phrase cannot derive.

const MISMATCH = "signing key does not match";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(
    tmpdir(),
    `kastle-optimize-funds-derivation-${process.pid}`,
  );
  // vite.build sets NODE_ENV=production in this worker; keep it for React.
  const env = process.env.NODE_ENV;
  await build({
    configFile: path.resolve("tests/optimize-funds/vite.config.mjs"),
    mode: "real-signer",
    build: { outDir },
  });
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;
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

const harness = (page: Page) =>
  page.evaluate(() => {
    const { calls, signedIsLegacy } = window.__optimize.state();
    return { calls, signedIsLegacy };
  });
const optimizeBtn = (page: Page) =>
  page.getByRole("button", { name: "Optimize", exact: true });

test("legacy record at index 1, flag unset: plans, then signs with the legacy key and submits", async ({
  page,
}) => {
  const errors = await open(page, "account=L&index=1");
  await expect(optimizeBtn(page)).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const txRow = page
    .locator("span", { hasText: /^Transactions$/ })
    .locator("..");
  await expect(txRow).toContainText("1");
  await optimizeBtn(page).click();
  await expect(page.getByText("Optimize succeeded stub")).toBeVisible();
  const { calls, signedIsLegacy } = await harness(page);
  expect(calls.signTx).toBe(1);
  expect(calls.submit).toBe(1);
  expect(signedIsLegacy).toEqual([true]);
  expect(errors).toEqual([]);
});

test("record the phrase cannot derive: the mismatch is shown, nothing signed", async ({
  page,
}) => {
  const errors = await open(page, "account=B&index=1");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(MISMATCH);
  await expect(alert).toContainText("Nothing was signed or sent");
  await expect(optimizeBtn(page)).toHaveCount(0);
  const { calls } = await harness(page);
  expect(calls.signTx).toBe(0);
  expect(calls.submit).toBe(0);
  expect(errors).toEqual([]);
});
