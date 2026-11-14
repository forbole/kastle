import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real MigrationGuide route, built by tests/migration-guide/vite.config.mjs
// with useKcc20Migration / useAnalytics / wallet / RPC stubbed and stub Bridge
// and Dashboard routes. `?eligible=1` makes the hook expose a KAT URL.

const URL_FROM_HOOK = "https://katbridge.com/migrate";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-migration-guide-${process.pid}`);
  await build({
    configFile: path.resolve("tests/migration-guide/vite.config.mjs"),
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

async function open(page: Page, eligible: boolean) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/${eligible ? "?eligible=1" : ""}`);
  return errors;
}

const h = (page: Page) => page.evaluate(() => window.__migrationGuide);
const intro = (page: Page) =>
  page.getByRole("heading", {
    name: "What's changing for KRC-20 and ERC-20 tokens",
  });
const steps = (page: Page) =>
  page.getByRole("heading", { name: "Follow these steps on KAT Bridge" });
const nextBtn = (page: Page) => page.getByRole("button", { name: "Next" });
const openBtn = (page: Page) =>
  page.getByRole("button", { name: "Open KAT Bridge" });
// PageHeader's icon buttons: back first, close last.
const headerBack = (page: Page) => page.locator("button").first();

test("(a)+(d) enabled migration, no migratable holding → guide renders, never bounced", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?eligible=1&holding=0`);
  await expect(intro(page)).toBeVisible();
  // Give a bounce time to show itself.
  await page.waitForTimeout(300);
  expect((await h(page)).bridgeMounts).toBe(0);
  await expect(page.getByText("Bridge stub")).toHaveCount(0);
  await nextBtn(page).click();
  await openBtn(page).click();
  await expect
    .poll(async () => (await h(page)).tabs)
    .toEqual([{ url: URL_FROM_HOOK }]);
  expect(errors).toEqual([]);
});

test("eligible wallet is not bounced by the first, flag-less render", async ({
  page,
}) => {
  const errors = await open(page, true);
  await expect(intro(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect((await h(page)).bridgeMounts).toBe(0);
  expect(errors).toEqual([]);
});

test("(b) Next → step 2 → back returns to step 1; back on step 1 leaves", async ({
  page,
}) => {
  const errors = await open(page, true);
  await expect(intro(page)).toBeVisible();

  await nextBtn(page).click();
  await expect(steps(page)).toBeVisible();
  await expect(steps(page)).toBeFocused();
  await expect(page.locator("[aria-live=polite]")).toHaveText("Step 2 of 2");

  await headerBack(page).click();
  await expect(intro(page)).toBeVisible();
  await expect(nextBtn(page)).toBeVisible();
  await expect(page.locator("[aria-live=polite]")).toHaveText("Step 1 of 2");

  await headerBack(page).click();
  await expect(page.getByText("Bridge stub")).toBeVisible();
  expect((await h(page)).opened).toEqual([]);
  expect(errors).toEqual([]);
});

test("Enter twice on Next stays on step 2 and opens nothing", async ({
  page,
}) => {
  await open(page, true);
  await nextBtn(page).focus();
  await page.keyboard.press("Enter");
  await expect(steps(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(steps(page)).toBeVisible();
  await expect.poll(async () => (await h(page)).tabs.length).toBe(0);
  expect((await h(page)).opened).toEqual([]);
});

test("(c) analytics fire once per Open click, never on Next/Back/Close", async ({
  page,
}) => {
  const errors = await open(page, true);
  await nextBtn(page).click();
  await headerBack(page).click();
  await nextBtn(page).click();
  expect((await h(page)).opened).toEqual([]);

  await openBtn(page).click();
  await expect.poll(async () => (await h(page)).opened).toEqual(["bridge"]);
  expect((await h(page)).tabs).toEqual([{ url: URL_FROM_HOOK }]);

  await openBtn(page).click();
  await expect
    .poll(async () => (await h(page)).opened)
    .toEqual(["bridge", "bridge"]);
  expect((await h(page)).tabs).toHaveLength(2);

  // Close leaves without another event.
  await page.locator("button").nth(1).click();
  await expect(page.getByText("Bridge stub")).toBeVisible();
  expect((await h(page)).opened).toEqual(["bridge", "bridge"]);
  expect(errors).toEqual([]);
});
