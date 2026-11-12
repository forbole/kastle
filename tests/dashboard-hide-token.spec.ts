import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Hide / unhide a token: the dashboard tab-row menu opens the Manage Assets
// page, a switch there edits the hidden set, Back returns to the list. Renders
// the real Dashboard, ManageAssets, Assets list, send picker and detail
// screens through the asset-detail harness; its storage.local stub persists in
// localStorage across reloads.

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

// The real Dashboard: tab row with the Manage Assets menu, then the list.
const dashboard = (page: Page, query = "") =>
  open(page, "/dashboard-home", query);
// The Assets list alone, for layout checks that measure the rows themselves.
const assetsList = (page: Page, query = "") =>
  open(page, "/dashboard-assets", query);
const menuButton = (page: Page) =>
  page.getByRole("button", { name: "Manage Assets", exact: true });
const menuItem = (page: Page) =>
  page.getByRole("menuitem", { name: "Manage Assets", exact: true });
const back = (page: Page) => page.getByRole("button", { name: "Back" });
const switches = (page: Page) => page.getByRole("switch");
// Token switches; native KAS rows (every network) carry a disabled one.
const tokenSwitches = (page: Page) =>
  page.getByRole("switch", { disabled: false });
const lockedSwitches = (page: Page) =>
  page.getByRole("switch", { disabled: true });
// "Show <ticker>" plus " on <chain>" when the row carries a chain badge.
const sw = (page: Page, ticker: string) =>
  page.getByRole("switch", { name: new RegExp(`^Show ${ticker}( on .+)?$`) });
// Two KCC-20 rows (base + extension) and two KRC-20 rows in the stubs.
const ROWS = 4;

/** Tab row icon -> its one-item menu -> the Manage Assets page. */
async function openManage(page: Page) {
  await menuButton(page).click();
  await expect(menuItem(page)).toHaveCount(1);
  await menuItem(page).click();
  await expect(sw(page, "KAS").first()).toBeVisible();
}

/** Flip a switch to `shown`; retried, since a press before storage loads is ignored. */
async function setShown(s: Locator, shown: boolean) {
  await expect(async () => {
    if ((await s.getAttribute("aria-checked")) !== String(shown))
      await s.click();
    await expect(s).toHaveAttribute("aria-checked", String(shown), {
      timeout: 500,
    });
  }).toPass();
}

/** Back from the page lands on the dashboard list again. */
async function goBack(page: Page) {
  await back(page).click();
  await expect(menuButton(page)).toBeVisible();
}

async function hide(page: Page, ticker: string) {
  await openManage(page);
  for (const s of await sw(page, ticker).all()) await setShown(s, false);
  await goBack(page);
}

async function hideAll(page: Page, except?: string) {
  await openManage(page);
  for (const s of await tokenSwitches(page).all())
    if (!except || !(await s.getAttribute("aria-label"))!.includes(except))
      await setShown(s, false);
  await goBack(page);
}

test("the tab-row menu opens the Manage Assets page, which puts a labelled switch on every token row", async ({
  page,
}) => {
  const errors = await dashboard(page);
  await expect(switches(page)).toHaveCount(0);
  await openManage(page);
  await expect(tokenSwitches(page)).toHaveCount(ROWS);
  for (const name of ["KASPY", "NACHO"])
    await expect(sw(page, name)).toHaveAttribute("aria-checked", "true");
  await expect(sw(page, "KTEST")).toHaveCount(2);
  // Keyboard: Space flips the focused switch.
  const kaspy = sw(page, "KASPY");
  await kaspy.focus();
  await page.keyboard.press("Space");
  await expect(kaspy).toHaveAttribute("aria-checked", "false");
  // The balance column sits left of the switch, inside the row.
  const row = page.getByRole("listitem").filter({ has: kaspy });
  const bal = (await row.getByText("1 KASPY", { exact: true }).boundingBox())!;
  const swb = (await kaspy.boundingBox())!;
  expect(bal.x + bal.width).toBeLessThanOrEqual(swb.x);
  expect(errors).toEqual([]);
});

test("switching a token off and going back removes only that row", async ({
  page,
}) => {
  await dashboard(page);
  await expect(page.getByText("KASPY")).toBeVisible();
  await hide(page, "KASPY");
  await expect(switches(page)).toHaveCount(0);
  await expect(page.getByText("KASPY")).toHaveCount(0);
  await expect(page.getByText("NACHO")).toBeVisible();
  await expect(page.getByText("KTEST")).toHaveCount(2);
  // The page still lists it, switched off; on again brings it back.
  await openManage(page);
  await expect(sw(page, "KASPY")).toHaveAttribute("aria-checked", "false");
  await setShown(sw(page, "KASPY"), true);
  await goBack(page);
  await expect(page.getByText("KASPY")).toBeVisible();
});

test("the choice survives a popup reload and stays per account", async ({
  page,
}) => {
  await dashboard(page);
  await hide(page, "NACHO");
  await page.reload();
  await expect(page.getByText("KASPY")).toBeVisible();
  await expect(page.getByText("NACHO")).toHaveCount(0);
  // Another account does not inherit the hidden set.
  await dashboard(page, "&account2=1");
  await expect(page.getByText("NACHO")).toBeVisible();
});

test("a toggle applies only to the account it was made on", async ({
  page,
}) => {
  const aKey = "storage.local:hiddenTokens:mainnet:kaspa:qowner";
  const bKey = "storage.local:hiddenTokens:mainnet:kaspa:qsecond";
  const stored = (k: string) =>
    page.evaluate((key) => localStorage.getItem(key), k);
  // Account B hides NACHO on its own.
  await dashboard(page, "&account2=1");
  await hide(page, "NACHO");
  expect(await stored(bKey)).toBe(JSON.stringify(["krc20:nacho"]));
  // Account A switches KASPY off on the page: written to A alone.
  const errors = await dashboard(page);
  await openManage(page);
  await setShown(sw(page, "KASPY"), false);
  await expect.poll(() => stored(aKey)).toBe(JSON.stringify(["krc20:kaspy"]));
  expect(await stored(bKey)).toBe(JSON.stringify(["krc20:nacho"]));
  // The side menu selects account B while the page stays mounted: it now
  // shows B's set, not A's.
  await page.evaluate(() =>
    (window as unknown as { __selectAccount2: () => void }).__selectAccount2(),
  );
  await expect(sw(page, "NACHO")).toHaveAttribute("aria-checked", "false");
  await expect(sw(page, "KASPY")).toHaveAttribute("aria-checked", "true");
  // A toggle made now lands on B, never on A.
  await setShown(sw(page, "KTEST").first(), false);
  await expect
    .poll(async () => JSON.parse((await stored(bKey)) ?? "[]").length)
    .toBe(2);
  expect(JSON.parse((await stored(bKey))!)).toContain("krc20:nacho");
  expect(await stored(aKey)).toBe(JSON.stringify(["krc20:kaspy"]));
  // Back on the dashboard, account B: KASPY shows, NACHO stays hidden.
  await goBack(page);
  await expect(page.getByText("KASPY")).toBeVisible();
  await expect(page.getByText("NACHO")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Native KAS in the send picker: its row is a button whose label is exactly "KAS".
const kasPick = (page: Page) =>
  page
    .getByRole("button")
    .filter({ has: page.getByText("KAS", { exact: true }) });

test("a hidden KRC-20 and KCC-20 leave the send picker; KAS and the detail route stay", async ({
  page,
}) => {
  await dashboard(page);
  await openManage(page);
  await setShown(sw(page, "KASPY"), false);
  for (const s of await sw(page, "KTEST").all()) await setShown(s, false);
  await goBack(page);
  await expect(page.getByText("KASPY")).toHaveCount(0);
  await expect(page.getByText("KTEST")).toHaveCount(0);

  const errors = await open(page, "/asset-select");
  await expect(page.getByText("NACHO").first()).toBeVisible();
  await expect(kasPick(page)).toBeVisible();
  await expect(page.getByText("KASPY")).toHaveCount(0);
  await expect(page.getByText("KTEST")).toHaveCount(0);
  expect(errors).toEqual([]);

  // Hidden, not deleted: the detail screen still opens and still sends.
  await open(page, "/token-asset/KASPY");
  await expect(
    page.getByRole("button", { name: "Send KASPY", exact: true }),
  ).toBeVisible();
});

test("the send picker lists everything while storage is still being read, then settles", async ({
  page,
}) => {
  await dashboard(page);
  await hide(page, "KASPY");
  await open(page, "/asset-select", "&slowStorage=2500");
  // loaded === false: the whole list, never a blank panel.
  await expect(page.getByText("KASPY").first()).toBeVisible();
  await expect(page.getByText("NACHO").first()).toBeVisible();
  await expect(page.getByText("KASPY")).toHaveCount(0, { timeout: 6000 });
  await expect(page.getByText("NACHO").first()).toBeVisible();
});

test("with every token hidden the send picker still reaches native KAS", async ({
  page,
}) => {
  await dashboard(page);
  await hideAll(page);
  await expect(page.getByTestId("tokens-all-hidden")).toBeVisible();
  const errors = await open(page, "/asset-select");
  await expect(kasPick(page)).toBeVisible();
  for (const t of ["KASPY", "NACHO", "KTEST"])
    await expect(page.getByText(t)).toHaveCount(0);
  await expect(page.getByText("No result found")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("only the holdings lists read the hidden set", () => {
  // Dashboard, send picker, swap selectors, and the Manage Assets page that
  // edits the set. Not Activity (a record of what happened), token detail
  // screens, MintToken, balances or totals.
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
  expect(hits.map((p) => path.relative(process.cwd(), p)).sort()).toEqual(
    [
      path.join("components", "dashboard", "Assets.tsx"),
      path.join("components", "screens", "ManageAssets.tsx"),
      path.join("components", "screens", "Swap.tsx"),
      path.join("components", "screens", "asset-selector", "AssetSelect.tsx"),
    ].sort(),
  );
});

test("hiding every token shows a calm empty state with the way back", async ({
  page,
}) => {
  await dashboard(page);
  await hideAll(page);
  const empty = page.getByTestId("tokens-all-hidden");
  await expect(empty).toContainText("All your tokens are hidden.");
  await expect(switches(page)).toHaveCount(0);
  // The way back opens the Manage Assets page, every token switched off.
  await empty.getByRole("button", { name: "Show tokens" }).click();
  await expect(tokenSwitches(page)).toHaveCount(ROWS);
  for (const s of await tokenSwitches(page).all())
    await expect(s).toHaveAttribute("aria-checked", "false");
  await setShown(sw(page, "NACHO"), true);
  await goBack(page);
  await expect(empty).toHaveCount(0);
  await expect(page.getByText("NACHO")).toBeVisible();
});

test("one flat list: no heading between KAS and the tokens, and KAS cannot be hidden", async ({
  page,
}) => {
  await assetsList(page);
  const kas = page.getByTestId("kas-row");
  await expect(kas).toBeVisible();
  await expect(kas.getByRole("switch")).toHaveCount(0);
  await expect(page.locator('[data-part="ticker"]').nth(1)).toBeVisible();
  // Every sibling between the KAS row and the first token row.
  const between = await kas.evaluate((el) => {
    const out: { heading: boolean; text: string }[] = [];
    for (
      let n = el.nextElementSibling;
      n && !n.querySelector('[data-part="ticker"]');
      n = n.nextElementSibling
    )
      out.push({
        heading:
          !!n.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') ||
          !!n.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]'),
        text: (n.textContent ?? "").trim(),
      });
    return { out, reached: !!el.nextElementSibling };
  });
  expect(between.reached).toBe(true);
  for (const b of between.out) {
    expect(b.heading).toBe(false);
    expect(b.text).not.toMatch(/\bTokens\b/);
  }
  await expect(page.getByRole("heading")).toHaveCount(0);
  await expect(page.getByText("Tokens", { exact: true })).toHaveCount(0);
  // On the Manage Assets page the KAS row's switch is locked on.
  await dashboard(page);
  await openManage(page);
  const kasSwitch = page.getByRole("switch", { name: "Show KAS", exact: true });
  await expect(kasSwitch).toBeDisabled();
  await expect(kasSwitch).toHaveAttribute("aria-checked", "true");
  await kasSwitch.dispatchEvent("click");
  await expect(kasSwitch).toHaveAttribute("aria-checked", "true");
  await goBack(page);
  await expect(page.getByTestId("kas-row")).toBeVisible();
});

test("the Manage Assets control sits at the right end of the tab row", async ({
  page,
}) => {
  const errors = await dashboard(page);
  const tab = (name: string) => page.getByText(name, { exact: true }).first();
  const control = menuButton(page);
  await expect(control).toBeVisible();
  const c = (await control.boundingBox())!;
  const row = (await control.evaluate((el) => {
    // The tab row: the nearest ancestor that also holds the Text tab.
    let n = el.parentElement;
    while (n && !(n.textContent ?? "").includes("Text")) n = n.parentElement;
    return n!.getBoundingClientRect().toJSON();
  })) as { x: number; width: number };
  // Same row as the tabs, right of the last one, flush with the row's end.
  for (const name of ["Assets", "NFT", "Names", "Text"]) {
    const t = (await tab(name).boundingBox())!;
    expect(t.x + t.width, name).toBeLessThanOrEqual(c.x);
    expect(Math.abs(t.y + t.height / 2 - (c.y + c.height / 2))).toBeLessThan(
      c.height / 2,
    );
  }
  expect(Math.round(c.x + c.width)).toBe(Math.round(row.x + row.width));
  // Above every asset row.
  const kas = (await page.getByTestId("kas-row").boundingBox())!;
  expect(c.y + c.height).toBeLessThanOrEqual(kas.y);
  // Assets tab only.
  await tab("NFT").click();
  await expect(control).toHaveCount(0);
  await tab("Assets").click();
  await expect(control).toBeVisible();
  // A one-item menu; Esc closes it, choosing the item opens the page.
  await control.click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await openManage(page);
  await expect(tokenSwitches(page)).toHaveCount(ROWS);
  expect(errors).toEqual([]);
});

// Search moved to its own screen (Home header icon); the list no longer filters.
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search assets" });
const tickers = (page: Page) => page.locator('[data-part="ticker"]');

test("the list has no inline search: every row shows, with no Clear control", async ({
  page,
}) => {
  const errors = await dashboard(page);
  const all = await tickers(page).count();
  await expect(search(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(
    0,
  );
  await expect(tickers(page).filter({ hasText: "NACHO" })).toHaveCount(1);
  await expect(page.getByTestId("kas-row")).toBeVisible();
  await expect(tickers(page)).toHaveCount(all);
  await expect(page.getByText("NACHO")).toBeVisible();
  expect(errors).toEqual([]);
});

test("on the Manage Assets page every token row has a switch and KAS rows are locked", async ({
  page,
}) => {
  const errors = await dashboard(page);
  await openManage(page);
  await expect(search(page)).toHaveCount(0);
  await expect(tokenSwitches(page)).toHaveCount(ROWS);
  // Every row holds exactly one switch; token rows' are live.
  const rows = page.getByRole("listitem");
  const n = await rows.count();
  expect(n).toBe(await switches(page).count());
  for (const r of await rows.all())
    await expect(r.getByRole("switch")).toHaveCount(1);
  for (const t of ["KASPY", "NACHO"])
    await expect(rows.filter({ hasText: t }).getByRole("switch")).toBeEnabled();
  // Native KAS, on L1 and on every EVM network, is locked on and says why.
  const locked = lockedSwitches(page);
  expect(await locked.count()).toBeGreaterThanOrEqual(1);
  await expect(
    page.getByRole("switch", { name: "Show KAS", exact: true }),
  ).toBeDisabled();
  for (const s of await locked.all()) {
    await expect(s).toHaveAttribute("aria-label", /^Show i?KAS( on .+)?$/);
    await expect(s).toHaveAttribute("aria-checked", "true");
    await expect(s.locator("..")).toHaveAttribute(
      "aria-label",
      "KAS always stays visible",
    );
  }
  expect(errors).toEqual([]);
});

test("the list never shows a no-match state; the Manage Assets entry point stays reachable from the tab row", async ({
  page,
}) => {
  await dashboard(page);
  const empty = page.getByTestId("assets-no-match");
  await expect(empty).toHaveCount(0);
  await expect(search(page)).toHaveCount(0);
  await expect(menuButton(page)).toBeVisible();
  await expect(page.getByTestId("kas-row")).toBeVisible();
  await expect(tickers(page).filter({ hasText: "KTEST" })).toHaveCount(2);
  await expect(empty).toBeHidden();
  // Still reachable, and still opens the page, once every token is hidden.
  await hideAll(page);
  await expect(page.getByTestId("tokens-all-hidden")).toBeVisible();
  await expect(empty).toHaveCount(0);
  await openManage(page);
  await expect(tokenSwitches(page)).toHaveCount(ROWS);
});

test("a kascov-LISTED KCC-20 row reads like every other token row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 900 });
  const errors = await assetsList(page, "&listed=1");
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
  expect(errors).toEqual([]);
});

test("a ticker wider than the full balance still compacts the balance when that frees enough room", async ({
  page,
}) => {
  // 1,234,567,890.12 KTEST (compact 1.23B) beside a 10-letter symbol at the
  // popup's width: the ticker (~153px) is wider than the full figure (~134px)
  // and overflows its ~119px by ~34px; compacting gives back ~90px.
  await page.setViewportSize({ width: 375, height: 900 });
  const errors = await assetsList(
    page,
    `&ktestSymbol=${"W".repeat(10)}&ktestAmount=123456789012`,
  );
  const row = page.getByRole("button").filter({ hasText: "WWWW" }).first();
  const ticker = row.locator('[data-part="ticker"]');
  const figure = row.locator('[data-part="balance"] span').first();
  await expect(figure).toHaveText("1.23B");
  await expect(figure).toHaveAttribute("title", "1,234,567,890.12");
  expect(await ticker.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

// erc20=1 adds one ERC-20 row: WKAS on Kasplex L2, mixed-case address.
const withErc20 = (page: Page) => dashboard(page, "&erc20=1");
const WKAS_ID = "erc20:0x3173b:0xabcdef0123456789abcdef0123456789abcdef01";
const ownerKey = "storage.local:hiddenTokens:mainnet:kaspa:qowner";
const storedIds = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), ownerKey);

test("an ERC-20 row carries the same switch on the Manage Assets page", async ({
  page,
}) => {
  const errors = await withErc20(page);
  await expect(page.getByText("WKAS")).toBeVisible();
  await expect(switches(page)).toHaveCount(0);
  await openManage(page);
  await expect(tokenSwitches(page)).toHaveCount(ROWS + 1);
  const row = page.getByRole("listitem").filter({ hasText: "WKAS" });
  const wkas = row.getByRole("switch", { name: /^Show WKAS( on .+)?$/ });
  await expect(wkas).toHaveAttribute("aria-checked", "true");
  // The switch flips and never navigates away from the page.
  await setShown(wkas, false);
  await expect(back(page)).toBeVisible();
  // The row body itself does not navigate either.
  await row.click();
  await expect(back(page)).toBeVisible();
  await expect(wkas).toHaveAttribute("aria-checked", "false");
  // No draft: the page writes the toggle straight to the store.
  await expect.poll(() => storedIds(page)).toEqual([WKAS_ID]);
  expect(errors).toEqual([]);
});

test("hiding an ERC-20 row stores erc20:<chain>:<addr> and showing it brings it back", async ({
  page,
}) => {
  await withErc20(page);
  await openManage(page);
  // Fail on the missing switch itself, not on a timeout inside hide().
  await expect(sw(page, "WKAS")).toHaveCount(1);
  await goBack(page);
  await hide(page, "WKAS");
  await expect(switches(page)).toHaveCount(0);
  await expect(page.getByText("WKAS")).toHaveCount(0);
  await expect(page.getByText("KASPY")).toBeVisible();
  expect(await storedIds(page)).toEqual([WKAS_ID]);
  // The id round-trips through the store: still hidden after a reload.
  await page.reload();
  await expect(page.getByText("KASPY")).toBeVisible();
  await expect(page.getByText("WKAS")).toHaveCount(0);
  // The page lists it switched off; on again brings the row back.
  await openManage(page);
  await expect(sw(page, "WKAS")).toHaveAttribute("aria-checked", "false");
  await setShown(sw(page, "WKAS"), true);
  await goBack(page);
  await expect(page.getByText("WKAS")).toBeVisible();
  expect(await storedIds(page)).toEqual([]);
});

test("the all-hidden state counts ERC-20 rows, with no inline search over it", async ({
  page,
}) => {
  await withErc20(page);
  const empty = page.getByTestId("tokens-all-hidden");
  // Hide every row except WKAS: one visible ERC-20 row keeps the list.
  await hideAll(page, "WKAS");
  await expect(page.getByText("WKAS")).toBeVisible();
  await expect(empty).toHaveCount(0);
  // Hide WKAS too: now every token is hidden.
  await hide(page, "WKAS");
  await expect(empty).toContainText("All your tokens are hidden.");
  // No inline search or no-match state competes with the all-hidden state.
  await expect(search(page)).toHaveCount(0);
  await expect(page.getByTestId("assets-no-match")).toHaveCount(0);
  await expect(empty).toContainText("All your tokens are hidden.");
  await empty.getByRole("button", { name: "Show tokens" }).click();
  await expect(tokenSwitches(page)).toHaveCount(ROWS + 1);
});
