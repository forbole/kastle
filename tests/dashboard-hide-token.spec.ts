import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Hide / unhide a token on the dashboard. Renders the real Assets list (and
// the real send picker / KRC-20 detail screen) through the asset-detail
// harness; its storage.local stub persists in localStorage across reloads.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-hide-token-${process.pid}`);
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/asset-detail/vite.config.mjs"),
      build: { outDir },
      logLevel: "warn",
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

async function open(page: Page, route: string, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?route=${encodeURIComponent(route)}${query}`);
  return errors;
}

const dashboard = (page: Page, query = "") =>
  open(page, "/dashboard-assets", query);
const manage = (page: Page) =>
  page.getByRole("button", { name: "Manage tokens" });
const done = (page: Page) => page.getByRole("button", { name: "Done" });
const switches = (page: Page) => page.getByRole("switch");
// Two KCC-20 rows (base + extension) and two KRC-20 rows in the stubs.
const ROWS = 4;

async function hide(page: Page, name: RegExp) {
  await manage(page).click();
  await page.getByRole("switch", { name }).first().click();
  await done(page).click();
}

test("entering manage mode puts a labelled switch on every token row", async ({
  page,
}) => {
  const errors = await dashboard(page);
  await expect(switches(page)).toHaveCount(0);
  await manage(page).click();
  await expect(switches(page)).toHaveCount(ROWS);
  for (const name of ["Show KASPY", "Show NACHO"]) {
    const sw = page.getByRole("switch", { name, exact: true });
    await expect(sw).toHaveAttribute("aria-checked", "true");
  }
  // Keyboard: Space flips the focused switch.
  const kaspy = page.getByRole("switch", { name: "Show KASPY" });
  await kaspy.focus();
  await page.keyboard.press("Space");
  await expect(kaspy).toHaveAttribute("aria-checked", "false");
  // The balance column sits left of the switch, inside the row.
  const row = page.getByTestId("manage-row").filter({ hasText: "KASPY" });
  const bal = (await row.getByText("1", { exact: true }).boundingBox())!;
  const swb = (await kaspy.boundingBox())!;
  expect(bal.x + bal.width).toBeLessThanOrEqual(swb.x);
  expect(errors).toEqual([]);
});

test("switching a token off and pressing Done removes only that row", async ({
  page,
}) => {
  await dashboard(page);
  await expect(page.getByText("KASPY")).toBeVisible();
  await hide(page, /^Show KASPY$/);
  await expect(switches(page)).toHaveCount(0);
  await expect(page.getByText("KASPY")).toHaveCount(0);
  await expect(page.getByText("NACHO")).toBeVisible();
  await expect(page.getByText("KTEST")).toHaveCount(2);
  // The manage mode still lists it, switched off; on again brings it back.
  await manage(page).click();
  await expect(
    page.getByRole("switch", { name: "Show KASPY" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: "Show KASPY" }).click();
  await done(page).click();
  await expect(page.getByText("KASPY")).toBeVisible();
});

test("the choice survives a popup reload and stays per account", async ({
  page,
}) => {
  await dashboard(page);
  await hide(page, /^Show NACHO$/);
  await page.reload();
  await expect(page.getByText("KASPY")).toBeVisible();
  await expect(page.getByText("NACHO")).toHaveCount(0);
  // Another account does not inherit the hidden set.
  await dashboard(page, "&account2=1");
  await expect(page.getByText("NACHO")).toBeVisible();
});

test("a hidden token still shows in the send picker and its detail page", async ({
  page,
}) => {
  await dashboard(page);
  await hide(page, /^Show KASPY$/);
  await expect(page.getByText("KASPY")).toHaveCount(0);
  await open(page, "/asset-select");
  await expect(page.getByText("KASPY").first()).toBeVisible();
  await expect(page.getByText("KTEST").first()).toBeVisible();
  await open(page, "/token-asset/KASPY");
  await expect(
    page.getByRole("button", { name: "Send KASPY", exact: true }),
  ).toBeVisible();
});

test("only the dashboard list reads the hidden set", () => {
  // Display filter only: send, swap, detail, holdings and totals never import it.
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.stories\./.test(e.name))
        if (readFileSync(p, "utf8").includes("lib/hidden-tokens")) hits.push(p);
    }
  };
  for (const d of ["components", "hooks", "lib", "ui", "entrypoints"])
    walk(path.resolve(d));
  expect(hits.map((p) => path.relative(process.cwd(), p))).toEqual([
    path.join("components", "dashboard", "Assets.tsx"),
  ]);
});

test("hiding every token shows a calm empty state with the way back", async ({
  page,
}) => {
  await dashboard(page);
  await manage(page).click();
  for (const sw of await switches(page).all()) await sw.click();
  await done(page).click();
  const empty = page.getByTestId("tokens-all-hidden");
  await expect(empty).toContainText("All your tokens are hidden.");
  await expect(switches(page)).toHaveCount(0);
  await empty.getByRole("button", { name: "Show tokens" }).click();
  await expect(switches(page)).toHaveCount(ROWS);
  await page.getByRole("switch", { name: "Show NACHO" }).click();
  await done(page).click();
  await expect(empty).toHaveCount(0);
  await expect(page.getByText("NACHO")).toBeVisible();
});
