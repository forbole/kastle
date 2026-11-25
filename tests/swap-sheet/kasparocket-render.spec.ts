import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Render proof (money path): the real Swap screen, KaspaRocket chosen, its
// flag on. Built by ./kasparocket.vite.config.mjs; every request off the
// harness is aborted, so nothing reaches the proxy or the chain.

const SHOTS = "/tmp/kasparocket-render";
const PENDING = "A KaspaRocket swap on this pair is still settling.";
let base: string;
let server: http.Server;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const outDir = path.join(tmpdir(), `kastle-kasparocket-render-${process.pid}`);
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/swap-sheet/kasparocket.vite.config.mjs"),
      build: { outDir },
    });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  server = http.createServer((req, res) => {
    const p = path.resolve(outDir, "." + decodeURIComponent((req.url ?? "/").split("?")[0]));
    const file = p.startsWith(outDir) && existsSync(p) && statSync(p).isFile() ? p : path.join(outDir, "index.html");
    res.writeHead(200, {
      "content-type": { ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ?? "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

const sheet = (page: Page) => page.locator("dialog[open]");

/** KAS -> RKT on Kaspa L1, 200 KAS. */
async function open(page: Page, scenario: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route((u) => !u.href.startsWith(base), (r) => r.abort());
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto(`${base}/?scenario=${scenario}&screen=swap`);
  // A bundle that throws on load shows here, not as a locator timeout.
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/debug.png` });
  console.log("BODY>>", (await page.locator("body").innerText()).replace(/\n/g, " | "));
  await page.getByRole("button", { name: "iKAS", exact: true }).first().click();
  await sheet(page).getByRole("button", { name: "Kaspa", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Select" }).click();
  await sheet(page).getByRole("button", { name: /RKT/ }).click();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.locator("input").first().fill("200");
  return errors;
}

test("KaspaRocket chosen: the row is present and the plan's fee lines render", async ({ page }) => {
  const errors = await open(page, "rocket");
  await expect(page.getByText("KaspaRocket").first()).toBeVisible();
  await page.getByText("Est. Fee").first().click();
  await expect(sheet(page).getByText("Network")).toBeVisible();
  await expect(
    sheet(page).getByText("KaspaRocket fees", { exact: true }),
  ).toBeVisible();
  await expect(sheet(page).getByText("3 KAS", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/fee-lines.png` });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/selected.png` });
  expect(errors).toEqual([]);
});

test("a stored KaspaRocket record: the confirm says pending and is disabled", async ({ page }) => {
  const errors = await open(page, "rocket-pending");
  const confirm = page.getByRole("button", { name: PENDING });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/pending.png` });
  expect(errors).toEqual([]);
});
