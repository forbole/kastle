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
  // vite.build sets NODE_ENV=production in the worker; restore it so a later
  // React spec in the same worker does not load production React.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve(
        "tests/kas-send-confirm-capture/vite.config.mjs",
      ),
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

test("build-phase mass Error object (KASTLE-13 shape): not captured", async ({
  page,
}) => {
  const h = await confirm(page, "mass-error");
  expect(h.failed).toEqual([FRAGMENTATION]);
  expect(h.captured).toEqual([]);
});

test("build-phase planner bug is still captured", async ({ page }) => {
  const h = await confirm(page, "bug");
  expect(h.failed).not.toEqual([FRAGMENTATION]);
  expect(h.captured).toEqual(["TypeError: Cannot read properties of null"]);
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

// "Copy logs" on the KAS fail screen: the real KasSend, its report built from
// the thrown value, not from the reason the screen shows.
async function failSend(page: Page, scenario: string) {
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
  await page.goto(`${base}/?view=send&scenario=${scenario}`);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Sorry, Your Majesty.")).toBeVisible();
  expect(errors).toEqual([]);
}

test("broadcast rejected: Copy logs carries the node's reason, scrubbed", async ({
  page,
}) => {
  await failSend(page, "reject");
  // the screen shows the generic copy: the node's text is only in the report
  await expect(page.getByText("The carriage couldn't deliver")).toBeVisible();
  await page.getByRole("button", { name: "Copy logs" }).click();
  const text = await page.evaluate(
    () => (window as unknown as { __clip?: string }).__clip,
  );
  expect(text).toBeTruthy();
  expect(text).not.toContain("kaspa:");
  expect(text).not.toMatch(/[0-9a-f]{64}/i);
  const report = JSON.parse(text!);
  expect(report.flow).toBe("kas-send");
  expect(report.error).toContain("RPC Server (remote error)");
  expect(report.error).toContain("is already spent");
  expect(report.phase).toBe("broadcast");
  expect(report.extensionVersion).toBe("9.9.9");
  expect(report.networkId).toBe("mainnet");
});

test("build-phase fragmentation: the reason shows, Copy logs has the raw error", async ({
  page,
}) => {
  await failSend(page, "mass");
  await expect(page.getByText(FRAGMENTATION)).toBeVisible();
  await page.getByRole("button", { name: "Copy logs" }).click();
  const report = JSON.parse(
    await page.evaluate(() => (window as unknown as { __clip: string }).__clip),
  );
  expect(report.error).toBe("Storage mass exceeds maximum");
  expect(report.phase).toBe("build");
});

test("broadcast error whose .cause getter throws: fail screen, no Copy logs", async ({
  page,
}) => {
  await failSend(page, "hostile");
  await expect(page.getByText("The carriage couldn't deliver")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(0);
});
