import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real KAS ConfirmStep and planTransfer, built by
// tests/kas-send-confirm-capture/vite.config.mjs with the WASM, the batch
// signer and Sentry stubbed. A build-phase fragmentation or shortfall is a
// handled, user-visible failure and is not sent to Sentry; the same text from
// the broadcast phase still is (KASTLE-13, KASTLE-E).

const FRAGMENTATION =
  "This amount plus the network fee doesn't fit your balance — usually because it is spread across many small UTXOs. Try a smaller amount.";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-kas-confirm-${process.pid}`);
  await build({
    configFile: path.resolve("tests/kas-send-confirm-capture/vite.config.mjs"),
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

async function confirm(page: Page, scenario: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?scenario=${scenario}`);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__kasConfirm.failed.length))
    .toBe(1);
  expect(errors).toEqual([]);
  return page.evaluate(() => window.__kasConfirm);
}

test("build-phase mass error: fail reason shown, not captured", async ({
  page,
}) => {
  const h = await confirm(page, "mass");
  expect(h.failed).toEqual([FRAGMENTATION]);
  expect(h.captured).toEqual([]);
});

test("Confirm-time shortfall: fail reason shown, not captured", async ({
  page,
}) => {
  const h = await confirm(page, "short");
  expect(h.failed).toEqual([FRAGMENTATION]);
  expect(h.captured).toEqual([]);
});

test("broadcast-phase error with the same text is still captured", async ({
  page,
}) => {
  const h = await confirm(page, "broadcast");
  expect(h.failed).toEqual([FRAGMENTATION]);
  expect(h.captured).toEqual(["Error: Storage mass exceeds maximum"]);
});
