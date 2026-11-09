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
  page.getByRole("button", { name: "Manage", exact: true });
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

test("one flat list: no heading between KAS and the tokens, and KAS cannot be hidden", async ({
  page,
}) => {
  await dashboard(page);
  await manage(page).click();
  const kas = page.getByTestId("kas-row");
  await expect(kas).toBeVisible();
  await expect(kas.getByRole("switch")).toHaveCount(0);
  await expect(page.getByTestId("manage-row").first()).toBeVisible();
  // Every sibling between the KAS row and the first token row.
  const between = await kas.evaluate((el) => {
    const out: { heading: boolean; text: string }[] = [];
    for (
      let n = el.nextElementSibling;
      n && n.getAttribute("data-testid") !== "manage-row";
      n = n.nextElementSibling
    )
      out.push({
        heading:
          !!n.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') ||
          !!n.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]'),
        text: (n.textContent ?? "").trim(),
      });
    return out;
  });
  for (const b of between) {
    expect(b.heading).toBe(false);
    expect(b.text).not.toMatch(/\bTokens\b/);
  }
  await expect(page.getByRole("heading")).toHaveCount(0);
  await expect(page.getByText("Tokens", { exact: true })).toHaveCount(0);
});

// Asset rows (one ticker each) and the Manage / Done control, in document order.
const listOrder = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-part="ticker"], button')]
      .map((n) =>
        n.matches('[data-part="ticker"]')
          ? n.closest('[data-testid="kas-row"]')
            ? "kas"
            : "token"
          : /^(Manage|Done)$/.test(
                (n.getAttribute("aria-label") ?? n.textContent ?? "").trim(),
              )
            ? "control"
            : "",
      )
      .filter(Boolean),
  );

test("the Manage / Done control sits in a header row above every asset row", async ({
  page,
}) => {
  await dashboard(page);
  for (const mode of ["Manage", "Done"]) {
    const order = await listOrder(page);
    const control = order.indexOf("control");
    expect(control, `${mode}: ${order}`).toBeGreaterThanOrEqual(0);
    expect(control, `${mode}: ${order}`).toBeLessThan(order.indexOf("kas"));
    // KAS, then the tokens, continuous: no control between them.
    const between = order.slice(order.indexOf("kas"), order.indexOf("token"));
    expect(between, mode).not.toContain("control");
    if (mode === "Manage") await manage(page).click();
  }
  await expect(done(page)).toBeVisible();
});

const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search assets" });
const tickers = (page: Page) => page.locator('[data-part="ticker"]');

test("typing a token's label narrows the list to it; clear restores it", async ({
  page,
}) => {
  const errors = await dashboard(page);
  const all = await tickers(page).count();
  await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(
    0,
  );
  // Case-insensitive, on the displayed ticker.
  await search(page).fill("nacho");
  await expect(tickers(page)).toHaveText(["NACHO"]);
  await expect(page.getByTestId("kas-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(tickers(page)).toHaveCount(all);
  await expect(page.getByText("NACHO")).toBeVisible();
  expect(errors).toEqual([]);
});

test("in manage mode the search still works, KAS has no switch, a token row does", async ({
  page,
}) => {
  await dashboard(page);
  await manage(page).click();
  await expect(page.getByTestId("kas-row").getByRole("switch")).toHaveCount(0);
  await expect(
    page
      .getByTestId("manage-row")
      .filter({ hasText: "KASPY" })
      .getByRole("switch"),
  ).toHaveCount(1);
  await search(page).fill("KASPY");
  await expect(switches(page)).toHaveCount(1);
  await expect(page.getByRole("switch", { name: "Show KASPY" })).toBeVisible();
  await search(page).fill("kas");
  await expect(page.getByTestId("kas-row")).toBeVisible();
  await expect(page.getByTestId("kas-row").getByRole("switch")).toHaveCount(0);
  await expect(done(page)).toBeVisible();
});

test("an unmatched query shows the empty state with the way back", async ({
  page,
}) => {
  await dashboard(page);
  const empty = page.getByTestId("assets-no-match");
  await expect(empty).toHaveCount(0);
  await search(page).fill("zzzz-no-such-asset");
  await expect(tickers(page)).toHaveCount(0);
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("No assets match");
  // Search and Manage stay reachable while the list is empty.
  await expect(search(page)).toBeVisible();
  await expect(manage(page)).toBeVisible();
  await empty.getByRole("button", { name: "Show all assets" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(page.getByTestId("kas-row")).toBeVisible();
  // A matching query keeps the empty state hidden.
  await search(page).fill("KTEST");
  await expect(empty).toBeHidden();
  await expect(tickers(page)).toHaveCount(2);
});

test("a kascov-LISTED KCC-20 row reads like every other token row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 900 });
  const errors = await dashboard(page, "&listed=1");
  // listed_decimals: 8 scales 200,000,000,000 base units to 2,000 LUKE.
  const luke = page.getByRole("button").filter({ hasText: "LUKE" });
  await expect(luke).toBeVisible();
  await expect(luke.locator('[data-part="balance"] > span').first()).toHaveText(
    "2,000",
  );
  await expect(page.getByText(/base units/)).toHaveCount(0);
  // Unit price under the ticker, fiat under the balance: $0.0005 x 2,000.
  await expect(luke.locator('[data-part="ticker"] + span')).toHaveText(/\$/);
  await expect(luke.locator('[data-part="balance"] > span').nth(1)).toHaveText(
    /≈ \$1(\.00)?/,
  );
  // Same body, same geometry as the KAS and KRC-20 rows.
  const kas = page.getByTestId("kas-row");
  const kaspy = page
    .locator("div")
    .filter({ hasText: /^KASPY/ })
    .last();
  for (const row of [kas, luke]) {
    await expect(row.locator('[data-part="ticker"]')).toHaveCount(1);
    await expect(row.locator('[data-part="balance"] > span')).toHaveCount(2);
  }
  await expect(kaspy).toBeVisible();
  const box = async (l: typeof kas) => (await l.boundingBox())!;
  const tick = async (l: typeof kas) =>
    (await l.locator('[data-part="ticker"]').boundingBox())!;
  const [k, l] = [await box(kas), await box(luke)];
  expect(Math.round(l.height)).toBe(Math.round(k.height));
  expect(Math.round(l.width)).toBe(Math.round(k.width));
  expect(Math.round((await tick(luke)).x)).toBe(
    Math.round((await tick(kas)).x),
  );
  await page.screenshot({
    path: "/Users/leonardo/kastle-qa/qa6-shots/03-dashboard.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("a kascov-LISTED KCC-20 detail page shows the scaled balance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 900 });
  const errors = await open(page, `/kcc20/${"ef".repeat(32)}`, "&listed=1");
  // History amounts scale too (the stub's 100-unit receive).
  await expect(page.getByText("+0.000001 LUKE")).toBeVisible();
  await page.getByRole("tab", { name: "Token info" }).click();
  await expect(page.getByText("2,000 LUKE")).toBeVisible();
  await expect(page.getByText("8", { exact: true })).toBeVisible();
  await expect(page.getByText(/base units/)).toHaveCount(0);
  await page.screenshot({
    path: "/Users/leonardo/kastle-qa/qa6-shots/03-detail.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
