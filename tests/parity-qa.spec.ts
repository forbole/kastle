import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The KCC-20 parity surfaces, rendered with real styles in the three harnesses
// that mount them: tests/kcc20-send (dashboard rows, send picker),
// tests/asset-detail (token detail), tests/swap-sheet (swap selector,
// provider rows). Each test asserts the DOM; QA_SHOTS=<dir> also writes one
// PNG per surface at the popup's 500 px working width.

const SHOTS = process.env.QA_SHOTS;
const WIDTH = 500;
const KCC20_ID = "ab".repeat(32);
// Copy that this branch removed from every KCC-20 surface.
const GONE =
  /Unverified KCC-20|\(base units\)|Amount: Unavailable|To: Unavailable|Status: Unknown/;
// A family or standard chip: the label alone in an element.
const FAMILY_CHIP = /^(KRON|KCC-20|KCC20|Kaspa-KCC20|Standard|Legacy)$/;

const harnesses = {
  send: "tests/kcc20-send/vite.config.mjs",
  detail: "tests/asset-detail/vite.config.mjs",
  swap: "tests/swap-sheet/vite.config.mjs",
} as const;
type Harness = keyof typeof harnesses;
const bases = {} as Record<Harness, string>;
const servers: http.Server[] = [];

function serve(outDir: string) {
  const server = http.createServer((req, res) => {
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
    const type: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "content-type": type[path.extname(file)] ?? "text/html",
    });
    res.end(readFileSync(file));
  });
  servers.push(server);
  return new Promise<string>((r) =>
    server.listen(0, "127.0.0.1", () =>
      r(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    ),
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  // vite.build sets NODE_ENV=production in this worker; React specs that
  // run later in the same worker need act(), so restore it.
  const nodeEnv = process.env.NODE_ENV;
  try {
    for (const [key, config] of Object.entries(harnesses)) {
      const outDir = path.join(
        tmpdir(),
        `kastle-parity-qa-${key}-${process.pid}`,
      );
      await build({
        configFile: path.resolve(config),
        build: { outDir },
        logLevel: "warn",
      });
      bases[key as Harness] = await serve(outDir);
    }
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => servers.forEach((s) => s.close()));

/** Opens a harness at the popup's working width; collects page errors and console errors. */
async function open(page: Page, harness: Harness, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewportSize({ width: WIDTH, height: 800 });
  await page.goto(`${bases[harness]}/?${query}`);
  // The harness popups are 375 px; the popup works at 500.
  await page.addStyleTag({
    content: `#popup{width:${WIDTH}px!important} body{margin:0;background:#0b1a21}`,
  });
  await page.mouse.move(0, 799);
  return errors;
}

/** One PNG of `target`; `fullWidth` widens it to the popup's 500 px, as a row sits in it. */
async function shot(
  page: Page,
  name: string,
  target = page.locator("#popup"),
  fullWidth = false,
) {
  if (!SHOTS) return;
  await page.mouse.move(0, 799);
  await page.evaluate(() => document.fonts.ready);
  if (!fullWidth) {
    await target.screenshot({
      path: path.join(SHOTS, name),
      animations: "disabled",
    });
    return;
  }
  const popup = (await page.locator("#popup").boundingBox())!;
  const box = (await target.boundingBox())!;
  await page.screenshot({
    path: path.join(SHOTS, name),
    animations: "disabled",
    clip: { x: popup.x, y: box.y - 4, width: WIDTH, height: box.height + 8 },
  });
}

/** Every leaf element whose own text is a family label, outside `allowed` (e.g. the info rows). */
async function familyChips(
  page: Page,
  scope = page.locator("body"),
  allowed = "",
) {
  return scope.evaluate(
    (root, [src, allowed]) => {
      const re = new RegExp(src);
      return [...root.querySelectorAll("*")]
        .filter(
          (el) =>
            el.children.length === 0 &&
            re.test(el.textContent?.trim() ?? "") &&
            !(allowed && el.closest(allowed)),
        )
        .map((el) => el.outerHTML);
    },
    [FAMILY_CHIP.source, allowed] as const,
  );
}

/** An <img> drew: it loaded and has pixels. */
async function drawn(page: Page, img: ReturnType<Page["locator"]>) {
  await expect(img).toHaveJSProperty("complete", true);
  return img.evaluate((el: HTMLImageElement) => ({
    src: el.getAttribute("src") ?? "",
    width: el.naturalWidth,
  }));
}

// 1, 2: dashboard rows
test("01 KRON and standard dashboard rows: no family chip, balance right-aligned in one line", async ({
  page,
}) => {
  const errors = await open(page, "send", "route=/dashboard-families");
  const kron = page.locator('[data-row="kron"]');
  const standard = page.locator('[data-row="standard"]');
  await expect(kron).toContainText("WHALE");
  await expect(standard).toContainText("NACHO");
  expect(await familyChips(page)).toEqual([]);
  await expect(page.locator("body")).not.toContainText(GONE);

  for (const row of [kron, standard]) {
    const balance = row.locator('[data-part="balance"]');
    await expect(balance).toHaveClass(/\btext-right\b/);
    await expect(balance).toHaveClass(/\bitems-end\b/);
    // Its right edge is the row's content edge (p-3 = 12 px).
    const r = (await row.locator("button").boundingBox())!;
    const b = (await balance.boundingBox())!;
    expect(Math.abs(r.x + r.width - 12 - (b.x + b.width))).toBeLessThan(1.5);
    // Ticker left of balance, never under it.
    const ticker = (await row
      .getByText(/WHALE|NACHO/)
      .first()
      .boundingBox())!;
    expect(ticker.x + ticker.width).toBeLessThanOrEqual(b.x);
  }
  await expect(kron).toContainText("128,001");
  await expect(standard).toContainText("10,000");
  await shot(page, "01-row-kron.png", kron, true);
  await shot(page, "02-row-standard.png", standard, true);
  expect(errors).toEqual([]);
});

test("02 standard rows: decimals without ticker, ticker without decimals, a 12-digit balance", async ({
  page,
}) => {
  // Decimals, no ticker: a formatted whole-token amount under the short id.
  let errors = await open(page, "send", "route=/dashboard&notick=1");
  const row = page.getByRole("button").first();
  await expect(row).toContainText("10,000");
  await expect(row).not.toContainText(/base units/);
  expect(errors).toEqual([]);

  // Ticker, no decimals: grouped base units, the unit word once.
  errors = await open(page, "send", "route=/dashboard&nodecimals=1");
  const text = (await page.getByRole("button").first().textContent())!;
  expect(text).toContain("1,000,000");
  expect(text.match(/base units/g)).toHaveLength(1);
  expect(text).not.toMatch(GONE);
  expect(errors).toEqual([]);

  // 12 digits of base units: one line, the ticker shown in full.
  errors = await open(
    page,
    "send",
    "route=/dashboard&nodecimals=1&token=123456789012",
  );
  const big = page.getByRole("button").first();
  const ticker = big.getByText("NACHO", { exact: true });
  await expect(ticker).toBeVisible();
  expect(await ticker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const balance = big.locator('[data-part="balance"] > span').first();
  const lineHeight = await balance.evaluate(
    (el) => parseFloat(getComputedStyle(el).lineHeight) || 24,
  );
  expect((await balance.boundingBox())!.height).toBeLessThanOrEqual(
    lineHeight + 1,
  );
  expect(errors).toEqual([]);
});

test("03 send picker: KCC-20 row has no family chip and no status copy", async ({
  page,
}) => {
  const errors = await open(page, "send", "route=/asset-select");
  await expect(page.getByText("NACHO").first()).toBeVisible();
  expect(await familyChips(page)).toEqual([]);
  await expect(page.locator("body")).not.toContainText(GONE);
  expect(errors).toEqual([]);
});

// 4: token detail
test("04 token detail, Token info: the five rows in order, no family chip", async ({
  page,
}) => {
  // h=760: the whole info card in one frame (the popup itself is 600 tall and scrolls).
  const errors = await open(page, "detail", `route=/kcc20/${KCC20_ID}&h=760`);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["History", "Token info"]);
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Covenant ID");
  const rows = await panel
    .locator("section > div > div")
    .evaluateAll((els) => els.map((el) => el.children[0]?.textContent?.trim()));
  expect(rows.slice(0, 5)).toEqual([
    "Network",
    "Standard",
    "Balance",
    "Decimals",
    "Covenant ID",
  ]);
  // As mobile, the holding carries its ticker.
  await expect(
    panel.locator("section > div > div", { hasText: /^Balance/ }),
  ).toHaveText("Balance10,000 KTEST");
  // The Standard row names the standard; nothing outside the rows is a chip.
  await expect(panel.locator("section")).toContainText("KCC-20");
  expect(await familyChips(page, page.locator("#popup"), "section")).toEqual(
    [],
  );
  await expect(page.locator("body")).not.toContainText(GONE);
  await shot(page, "03-detail-info.png");
  expect(errors).toEqual([]);
});

test("05 token detail, History: logo, title, TX Hash, signed amount, no date", async ({
  page,
}) => {
  const errors = await open(
    page,
    "detail",
    `route=/kcc20/${KCC20_ID}&historySend=1`,
  );
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const row = page.getByRole("button", { name: /^Received/ });
  await expect(row).toBeVisible();
  const parts = await row.evaluate((el) => {
    const [logo, left, right] = [...el.children] as HTMLElement[];
    return {
      logo: !!logo.querySelector("img"),
      left: [...left.children].map((c) => c.textContent),
      right: [...right.children].map((c) => c.textContent),
      rightAligned: getComputedStyle(right).alignItems,
    };
  });
  expect(parts.logo).toBe(true);
  expect(parts.left).toEqual(["Received", "TX Hash1"]);
  // The page names the token, so the amount drops the symbol.
  expect(parts.right[0]).toBe("+1");
  // The time moved into the TX Hash card: no date cell on the row.
  expect(parts.right.join(" ")).not.toMatch(
    /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M/,
  );
  expect(parts.rightAligned).toBe("flex-end");
  // A send signs negative, with no recipient line; no txid on either row.
  const sent = page.getByRole("button", { name: /^Sent/ });
  await expect(sent).toContainText(/TX Hash\s*1/);
  await expect(sent).not.toContainText("qrecipient");
  await expect(sent).toContainText("-2.5");
  await expect(sent).not.toContainText("KTEST");
  for (const r of [row, sent])
    expect(await r.textContent()).not.toMatch(/kcc20(tx|send)|[0-9a-f]{16}/);
  await expect(page.locator("body")).not.toContainText(GONE);
  await shot(page, "04-detail-history.png");
  expect(errors).toEqual([]);
});

test("09 a date is exact: no date cell, in the list or the detail sheet, carries ≈", async ({
  page,
}) => {
  const errors = await open(
    page,
    "detail",
    `route=/kcc20/${KCC20_ID}&historySend=1`,
  );
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const rows = page.getByRole("button", { name: /^(Received|Sent)/ });
  await expect(rows).toHaveCount(2);
  const dates = await rows.evaluateAll((bs) =>
    bs.map((b) => b.lastElementChild?.lastElementChild?.textContent ?? ""),
  );
  expect(dates).toHaveLength(2);
  for (const d of dates) {
    expect(d).toMatch(/\d{4}/);
    expect(d).not.toContain("≈");
  }
  await rows.first().click();
  const heading = page.getByRole("heading", { name: "TX Hash" });
  await expect(heading).toBeVisible();
  const sheetDate = await heading.evaluate(
    (h) => h.nextElementSibling?.textContent ?? "",
  );
  expect(sheetDate).toBe(dates[0]);
  expect(sheetDate).not.toContain("≈");
  expect(errors).toEqual([]);
});

test("10 a provider with no rate renders no subtitle and no dash, and keeps its row height", async ({
  page,
}) => {
  const errors = await open(page, "swap", "view=providers");
  const rows = page.getByTestId("providers").getByRole("button");
  await expect(rows).toHaveCount(2);
  const read = (i: number) =>
    rows.nth(i).evaluate((b) => {
      const text = b.querySelector("img + div") as HTMLElement;
      return {
        lines: [...text.children].map((c) => c.textContent ?? ""),
        height: b.getBoundingClientRect().height,
        nameCentre: (() => {
          const n = text.firstElementChild!.getBoundingClientRect();
          const img = b.querySelector("img")!.getBoundingClientRect();
          return Math.round(n.top + n.height / 2 - (img.top + img.height / 2));
        })(),
      };
    });
  const kron = await read(0);
  const braid = await read(1);
  expect(kron.lines).toEqual(["KRON", "1 KAS ≈ 13,789 WHALE"]);
  expect(braid.lines).toEqual(["Braid"]);
  expect(await rows.nth(1).textContent()).not.toMatch(/[-—–]|N\/A|No route/);
  expect(braid.height).toBe(kron.height);
  expect(Math.abs(braid.nameCentre)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

// 5, 7, 8: swap selector
test("06 swap selector: All / Standard / KRON, opening on All; tabs filter; a pick survives a tab switch", async ({
  page,
}) => {
  const errors = await open(page, "swap", "rows=6");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["All", "Standard", "KRON"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  const symbols = () =>
    page
      .locator("dialog button:not([role=tab])")
      .evaluateAll((bs) =>
        bs
          .map((b) => b.querySelector("span.font-semibold")?.textContent)
          .filter(Boolean),
      );
  expect(await symbols()).toEqual([
    "KAS",
    "STD0",
    "KRON1",
    "STD2",
    "KRON3",
    "STD4",
    "KRON5",
  ]);
  await shot(page, "05-swap-tabs.png", page.locator("dialog"));

  await page.getByRole("tab", { name: "Standard" }).click();
  expect(await symbols()).toEqual(["KAS", "STD0", "STD2", "STD4"]);
  await page.getByRole("button", { name: /STD2/ }).click();
  await expect(page.getByTestId("pair")).toHaveText("KAS → STD2");

  await page.getByRole("tab", { name: "KRON" }).click();
  expect(await symbols()).toEqual(["KAS", "KRON1", "KRON3", "KRON5"]);
  await expect(page.getByTestId("pair")).toHaveText("KAS → STD2");
  await page.getByRole("button", { name: /KRON3/ }).click();
  await expect(page.getByTestId("pair")).toHaveText("KAS → KRON3");
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByTestId("pair")).toHaveText("KAS → KRON3");

  // Standard carries Braid's mark, KRON KRON's, All none; both draw.
  await expect(tabs.nth(0).locator("img")).toHaveCount(0);
  for (const i of [1, 2]) {
    const img = await drawn(page, tabs.nth(i).locator("img"));
    expect(img.width).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

test("07 provider rows: KRON and Braid draw their marks", async ({ page }) => {
  const errors = await open(page, "swap", "view=providers");
  const rows = page.getByTestId("providers").getByRole("button");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("KRON");
  await expect(rows.nth(1)).toContainText("Braid");
  const srcs = [];
  for (const i of [0, 1]) {
    const img = await drawn(page, rows.nth(i).locator("img"));
    expect(img.width, `provider ${i}`).toBeGreaterThan(0);
    srcs.push(img.src);
  }
  // KRON's PNG is emitted as a file, Braid's 510-byte SVG inlined.
  expect(srcs[0]).toMatch(/kron-logo.*\.png$/);
  expect(srcs[1]).toMatch(/^data:image\/svg\+xml|braid-logo.*\.svg$/);
  for (const f of ["kron-logo.png", "braid-logo.svg"])
    expect(existsSync(path.resolve("assets/images/providers", f))).toBe(true);
  await shot(page, "06-provider-rows.png", page.getByTestId("providers"));
  expect(errors).toEqual([]);
});

test("08 a 200-row sheet mounts only the rows in view; it scrolls to the end and search filters", async ({
  page,
}) => {
  const errors = await open(page, "swap", "rows=200");
  const rowButtons = page.locator("dialog button:not([role=tab])");
  await expect(rowButtons.first()).toBeVisible();
  const mounted = await rowButtons.count();
  expect(mounted).toBeGreaterThan(5);
  expect(mounted).toBeLessThan(40);

  // The body scrolls the full list: its last row mounts at the bottom.
  await page
    .locator("dialog .overflow-y-auto")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.getByRole("button", { name: /KRON199/ })).toBeVisible();
  expect(await rowButtons.count()).toBeLessThan(40);

  // A pick takes no long task (>50 ms) on the main thread.
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => w.__long.push(e.duration)),
    ).observe({ type: "longtask" });
  });
  await page.getByRole("button", { name: /KRON199/ }).click();
  await expect(page.getByTestId("pair")).toHaveText("KAS → KRON199");
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () => (window as unknown as { __long: number[] }).__long,
    ),
  ).toEqual([]);

  await page.getByPlaceholder("Search token").fill("STD198");
  await expect(page.getByRole("button", { name: /STD198/ })).toBeVisible();
  expect(
    await rowButtons.evaluateAll(
      (bs) =>
        bs.filter((b) => b.querySelector("span.font-semibold")?.textContent)
          .length,
    ),
  ).toBe(1);
  expect(errors).toEqual([]);
});

test("08b a long claimed symbol stays on one line, so every sheet row keeps one stride", async ({
  page,
}) => {
  const errors = await open(page, "swap", "rows=6&longSymbol=1");
  const rowButtons = page.locator("dialog button:not([role=tab])");
  await expect(page.getByRole("button", { name: /KRON1 LONG/ })).toBeVisible();
  const heights = await rowButtons.evaluateAll((bs) =>
    bs
      .filter((b) => b.querySelector("span.font-semibold"))
      .map((b) => Math.round(b.getBoundingClientRect().height)),
  );
  expect(heights.length).toBeGreaterThan(3);
  // KAS has no address line; the token rows all match each other.
  expect(new Set(heights.slice(1)).size).toBe(1);
  expect(errors).toEqual([]);
});

// QA issue 6: the swap selector drops tokens hidden on the dashboard, by the
// same kcc20:<covenant> id; KAS has no id and always stays.
const STD0 = "kcc20:" + "ab".repeat(31) + "00";
// The sheet's rows in order, by their symbol, as test 06 reads them.
const sheetSymbols = (page: Page) =>
  page
    .locator("dialog button:not([role=tab])")
    .evaluateAll((bs) =>
      bs
        .map((b) => b.querySelector("span.font-semibold")?.textContent)
        .filter(Boolean),
    );

test("a token hidden on the dashboard is absent from the swap selector", async ({
  page,
}) => {
  const errors = await open(page, "swap", `rows=4&hidden=${STD0}`);
  await expect(page.getByRole("button", { name: /KRON1/ })).toBeVisible();
  expect(await sheetSymbols(page)).toEqual(["KAS", "KRON1", "STD2", "KRON3"]);
  expect(errors).toEqual([]);
});

test("with every token hidden the swap selector still lists KAS", async ({
  page,
}) => {
  const all = [0, 1, 2, 3]
    .map((i) => "kcc20:" + (i % 2 ? "cd" : "ab").repeat(31) + `0${i}`)
    .join(",");
  const errors = await open(page, "swap", `rows=4&hidden=${all}`);
  await expect(page.getByRole("button", { name: /KAS/ })).toBeVisible();
  expect(await sheetSymbols(page)).toEqual(["KAS"]);
  expect(errors).toEqual([]);
});
