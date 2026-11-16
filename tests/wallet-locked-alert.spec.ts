import { expect, test } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real WalletLockedAlert, built by tests/wallet-locked-alert/vite.config.mjs
// with its hooks and `browser` stubbed. On desktop Android Chrome rejects
// browser.action.openPopup(); the Unlock button must show a hint instead of
// leaking an unhandled rejection to Sentry (KASTLE-4T).

const HINT =
  "Kastle couldn't be opened from this page. Open it from your browser to unlock.";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-wallet-locked-${process.pid}`);
  await build({
    configFile: path.resolve("tests/wallet-locked-alert/vite.config.mjs"),
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

test("openPopup rejection shows the hint, no unhandled rejection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.getByText(HINT)).toHaveCount(0);
  await page.getByRole("button", { name: "Unlock Wallet now" }).click();
  await expect(page.getByText(HINT)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(HINT);
  expect(await page.evaluate(() => window.__walletLocked.rejections)).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});

test("openPopup resolving leaves the hint absent", async ({ page }) => {
  await page.goto(base);
  await page.evaluate(() => window.__walletLocked.openPopup.push("resolve"));
  await page.getByRole("button", { name: "Unlock Wallet now" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__walletLocked.openPopupCalls))
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Unlock Wallet now" }),
  ).toBeEnabled();
  await expect(page.getByText(HINT)).toHaveCount(0);
});

test("a successful retry clears the hint", async ({ page }) => {
  await page.goto(base);
  await page.evaluate(() =>
    window.__walletLocked.openPopup.push("reject", "resolve"),
  );
  const button = page.getByRole("button", { name: "Unlock Wallet now" });
  await button.click();
  await expect(page.getByRole("status")).toHaveText(HINT);
  await button.click();
  await expect
    .poll(() => page.evaluate(() => window.__walletLocked.openPopupCalls))
    .toBe(2);
  await expect(button).toBeEnabled();
  await expect(page.getByText(HINT)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("");
});

test("a double click fires one openPopup at a time", async ({ page }) => {
  await page.goto(base);
  await page.evaluate(() => (window.__walletLocked.openPopupDelayMs = 300));
  await page.getByRole("button", { name: "Unlock Wallet now" }).dblclick();
  await expect(page.getByText(HINT)).toBeVisible();
  expect(await page.evaluate(() => window.__walletLocked.openPopupCalls)).toBe(
    1,
  );
});
