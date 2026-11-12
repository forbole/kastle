import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The asset detail screens share one top bar (GeneralHeader, variant "asset")
// and one send action (AssetSendButton). The harness in tests/asset-detail
// renders the real screens with their data hooks and tab bodies stubbed.

const KCC20_ID = "ab".repeat(32);
const ERC20 = "0x00000000000000000000000000000000000000e2";
// As in tests/asset-detail/stubs.tsx.
const KCC20_EXT = "cd".repeat(32);
const ISSUE_CA = "kaspa:qissuetoken";
const ISSUE_NAME = "KaspaIssueModeTokenWithAVeryLongName";
const LONG_DOTK = "thisisaverylongdotknamethatmustwrap.k";

const SCREENS = [
  { key: "KAS", route: "/kas-asset", ticker: "KAS", send: "/kas/send" },
  {
    key: "KRC-20",
    route: "/token-asset/KASPY",
    ticker: "KASPY",
    send: "/krc20/send/KASPY",
  },
  {
    key: "ERC-20",
    route: `/erc20-asset/0x97b4/${ERC20}`,
    ticker: "WKAS",
    send: `/erc20/send/0x97b4/${ERC20}`,
  },
  {
    key: "EVM KAS",
    route: "/evm-asset/0x97b4",
    ticker: "iKAS",
    send: "/evm-kas/send/0x97b4",
  },
  {
    key: "dotK",
    route: "/dotk/alice.k",
    ticker: "alice.k",
    send: "/dotk/alice.k/transfer",
  },
  {
    key: "KCC-20",
    route: `/kcc20/${KCC20_ID}`,
    ticker: "KTEST",
    send: `/kcc20/send/${KCC20_ID}`,
  },
] as const;

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-asset-detail-${process.pid}`);
  // vite.build sets NODE_ENV=production for this worker; React specs that
  // later run in the same worker need act(), so restore it.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/asset-detail/vite.config.mjs"),
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
    // Nothing outside the build dir, whatever `..` the URL carries.
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
          ".woff2": "font/woff2",
        }[path.extname(file)] ?? "text/html",
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

const sendButton = (page: Page, ticker: string) =>
  page.getByRole("button", { name: `Send ${ticker}`, exact: true });

// Boxes of the shared chrome, relative to the popup.
async function chrome(page: Page, ticker: string) {
  const popup = (await page.locator("#popup").boundingBox())!;
  const rel = async (selector: ReturnType<Page["locator"]>) => {
    const b = (await selector.boundingBox())!;
    return {
      x: b.x - popup.x,
      y: b.y - popup.y,
      width: b.width,
      height: b.height,
    };
  };
  const heading = await rel(page.getByRole("heading", { level: 1 }));
  const font = await page.getByRole("heading", { level: 1 }).evaluate((h) => {
    const s = getComputedStyle(h);
    return [s.fontFamily, s.fontSize, s.fontWeight, s.color, s.textAlign].join(
      " ",
    );
  });
  return {
    back: await rel(page.getByRole("button", { name: "Back" })),
    close: await rel(page.getByRole("button", { name: "Close" })),
    // The title box hugs its text; its centre and top are what must match.
    titleCentre: heading.x + heading.width / 2,
    titleTop: heading.y,
    font,
    send: await rel(sendButton(page, ticker)),
    sendStyle: await sendButton(page, ticker).evaluate((b) => {
      const s = getComputedStyle(b);
      return [
        s.fontFamily,
        s.fontSize,
        s.fontWeight,
        s.borderRadius,
        s.borderColor,
        s.paddingTop,
      ].join(" ");
    }),
  };
}

for (const s of SCREENS) {
  test(`${s.key}: header title and "Send ${s.ticker}" render`, async ({
    page,
  }) => {
    const errors = await open(page, s.route);
    await expect(
      page.getByRole("heading", { level: 1, name: s.ticker, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(sendButton(page, s.ticker)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${s.key}: Send opens the existing send route`, async ({ page }) => {
    await open(page, s.route);
    await sendButton(page, s.ticker).click();
    await expect(page.getByTestId("landed")).toHaveText(s.send);
  });

  test(`${s.key}: Back and Close go to the dashboard`, async ({ page }) => {
    await open(page, s.route);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("landed")).toHaveText("/dashboard");
    await open(page, s.route);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("landed")).toHaveText("/dashboard");
  });

  test(`${s.key}: on a short popup Send never covers content`, async ({
    page,
  }) => {
    await open(page, s.route, "&tall=1&h=320");
    // KCC-20, ERC-20 and EVM KAS have a real History list, not a stub: only
    // Token info is that tall.
    if (s.key === "KCC-20" || s.key === "ERC-20" || s.key === "EVM KAS")
      await page.getByRole("tab", { name: "Token info", exact: true }).click();
    const body = page.locator("#popup .overflow-y-auto").first();
    const send = sendButton(page, s.ticker);
    await expect(send).toBeVisible();
    const scrolls = await body.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    );
    expect(scrolls).toBe(true);
    const b = (await body.boundingBox())!;
    const btn = (await send.boundingBox())!;
    expect(btn.y).toBeGreaterThanOrEqual(b.y + b.height);
  });
}

test("every asset screen has the same top bar and send button", async ({
  page,
}) => {
  const [first, ...rest] = SCREENS;
  await open(page, first.route);
  const reference = await chrome(page, first.ticker);
  for (const s of rest) {
    await open(page, s.route);
    expect(await chrome(page, s.ticker), s.key).toEqual(reference);
  }
});

// Every asset screen, and every state of one that changes its top bar.
// title: the h1 text; send: the Send label, or undefined where Send is hidden.
const BARS: {
  key: string;
  route: string;
  query?: string;
  title?: string;
  send?: string;
}[] = [
  ...SCREENS.map((s) => ({
    key: s.key,
    route: s.route,
    title: s.ticker,
    send: s.ticker,
  })),
  {
    key: "KRC-20 issue mode",
    route: `/token-asset/${ISSUE_CA}`,
    title: ISSUE_NAME,
    send: ISSUE_NAME,
  },
  {
    key: "dotK, long name",
    route: `/dotk/${LONG_DOTK}`,
    title: LONG_DOTK,
    send: LONG_DOTK,
  },
  // The route guard waits for the wallet and the flags; no Send until it is done.
  {
    key: "KCC-20, guard waiting",
    route: `/kcc20/${KCC20_ID}`,
    query: "&kcc20Pending=1",
  },
];

// Boxes of Back, Close and Send relative to the popup: KAS is the reference.
async function boxes(page: Page, send?: string) {
  const popup = (await page.locator("#popup").boundingBox())!;
  const rel = async (l: ReturnType<Page["locator"]>) => {
    const b = (await l.boundingBox())!;
    return [b.x - popup.x, b.y - popup.y, b.width, b.height];
  };
  return {
    back: await rel(page.getByRole("button", { name: "Back" })),
    close: await rel(page.getByRole("button", { name: "Close" })),
    send: send && (await rel(sendButton(page, send))),
  };
}

for (const s of BARS) {
  test(`${s.key}: Back, title and Close, in order, and Send at the bottom`, async ({
    page,
  }) => {
    await open(page, "/kas-asset");
    const reference = await boxes(page, "KAS");

    await open(page, s.route, s.query);
    const heading = page.getByRole("heading", { level: 1 });
    if (s.title) await expect(heading).toHaveText(s.title);
    else await expect(heading).not.toBeEmpty();

    // Exactly these three, in this order: a hidden Back or Close leaves a
    // placeholder div in its place, and fails here.
    const bar = await heading.evaluate((h) =>
      [...h.parentElement!.children].map((c) =>
        c.tagName === "H1"
          ? "title"
          : `${c.tagName} ${c.getAttribute("aria-label")}`,
      ),
    );
    expect(bar, s.key).toEqual(["BUTTON Back", "title", "BUTTON Close"]);
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();

    if (s.send) await expect(sendButton(page, s.send)).toBeVisible();
    else
      await expect(page.getByRole("button", { name: /^Send / })).toHaveCount(0);

    // Same place and hit area as on KAS, also when the title wraps; Send has
    // the same size and the same gap to the bottom edge.
    const own = await boxes(page, s.send);
    expect(own.back, `${s.key} Back`).toEqual(reference.back);
    expect(own.close, `${s.key} Close`).toEqual(reference.close);
    if (s.send) expect(own.send, `${s.key} Send`).toEqual(reference.send);
  });
}

// Whatever follows the scrolling body of the page column. On every asset page
// it holds the Send action or nothing.
const bottomSlot = (page: Page) =>
  page.locator("#popup > div > .overflow-y-auto ~ *");

// One case per Send guard. Each case sets one stub knob (see stubs.tsx) and
// leaves the other guards open, so only that guard decides.
// Ledger cannot sign KRC-20, EVM or covenant transactions; KAS it can.
// KCC-20 has no Ledger case: its route guard keeps a Ledger off the page.
const GUARDS: {
  key: (typeof SCREENS)[number]["key"];
  when: string;
  query: string;
  send: boolean;
}[] = [
  { key: "KAS", when: "a balance of 0", query: "&kas0=1", send: false },
  { key: "KAS", when: "a Ledger wallet", query: "&ledger=1", send: true },
  { key: "KRC-20", when: "a Ledger wallet", query: "&ledger=1", send: false },
  { key: "KRC-20", when: "a non-Ledger wallet", query: "", send: true },
  {
    key: "KRC-20",
    when: "a wallet still loading",
    query: "&walletLoading=1",
    send: false,
  },
  { key: "ERC-20", when: "a Ledger wallet", query: "&ledger=1", send: false },
  { key: "ERC-20", when: "a non-Ledger wallet", query: "", send: true },
  { key: "ERC-20", when: "a balance of 0", query: "&erc20Zero=1", send: false },
  { key: "ERC-20", when: "no balance", query: "&erc20None=1", send: false },
  {
    key: "ERC-20",
    when: "a wallet still loading",
    query: "&walletLoading=1",
    send: false,
  },
  { key: "EVM KAS", when: "a Ledger wallet", query: "&ledger=1", send: false },
  { key: "EVM KAS", when: "a non-Ledger wallet", query: "", send: true },
  {
    key: "EVM KAS",
    when: "a wallet still loading",
    query: "&walletLoading=1",
    send: false,
  },
  {
    key: "dotK",
    when: "a name it does not own",
    query: "&notOwner=1",
    send: false,
  },
  {
    key: "dotK",
    when: "the owner, flag off",
    query: "&dotkOff=1",
    send: false,
  },
  { key: "dotK", when: "the owner, flag on", query: "", send: true },
  { key: "dotK", when: "a Ledger owner", query: "&ledger=1", send: false },
  { key: "KCC-20", when: "spendable 0", query: "&spendable0=1", send: false },
  { key: "KCC-20", when: "spendable above 0", query: "", send: true },
];

for (const g of GUARDS) {
  const s = SCREENS.find((x) => x.key === g.key)!;
  test(`${g.key}, ${g.when}: Send is ${g.send ? "shown" : "hidden"}`, async ({
    page,
  }) => {
    await open(page, s.route, g.query);
    await expect(
      page.getByRole("heading", { level: 1, name: s.ticker, exact: true }),
    ).toBeVisible();
    if (g.send) {
      await expect(sendButton(page, s.ticker)).toBeVisible();
      await expect(bottomSlot(page)).toHaveCount(1);
    } else {
      await expect(bottomSlot(page)).toHaveCount(0);
    }
  });
}

test("dotK, a Ledger owner: the notice is in the body", async ({ page }) => {
  await open(page, "/dotk/alice.k", "&ledger=1");
  await expect(
    page.locator("#popup > div > .overflow-y-auto").getByText(/^Ledger can’t/),
  ).toBeVisible();
  await expect(bottomSlot(page)).toHaveCount(0);
});

test("KCC-20, lookup unresolved: no detail page, then the error", async ({
  page,
}) => {
  await open(page, `/kcc20/${KCC20_ID}`, "&kcc20Loading=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Unverified")).toHaveCount(0);
  await expect(bottomSlot(page)).toHaveCount(0);

  await open(page, `/kcc20/${KCC20_ID}`, "&kcc20Error=1");
  await expect(
    page.getByText("Token details could not be loaded"),
  ).toBeVisible();
  await expect(page.getByText("Unverified")).toHaveCount(0);
  await expect(bottomSlot(page)).toHaveCount(0);
});

test("KCC-20: Send keeps the ext of the row", async ({ page }) => {
  await open(page, `/kcc20/${KCC20_ID}?ext=${KCC20_EXT}`);
  await sendButton(page, "KTEST").click();
  await expect(page.getByTestId("landed")).toHaveText(
    `/kcc20/send/${KCC20_ID}?ext=${KCC20_EXT}`,
  );
});

// The tab control of the design system (components/AssetTabs). dotK has no tabs.
const TABS_NAV =
  "--prevent-on-load-init flex gap-x-1 rounded-xl bg-daintree-800 p-1";
const TAB_BUTTON =
  "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-[#E5E7EB] focus:outline-none disabled:pointer-events-none disabled:opacity-50";

// active: the tab each screen opens on.
const TABBED = [
  { key: "KAS", route: "/kas-asset", active: "History" },
  { key: "KRC-20", route: "/token-asset/KASPY", active: "History" },
  {
    key: "KRC-20 issue mode",
    route: `/token-asset/${ISSUE_CA}`,
    active: "History",
  },
  {
    key: "ERC-20",
    route: `/erc20-asset/0x97b4/${ERC20}`,
    active: "History",
  },
  { key: "EVM KAS", route: "/evm-asset/0x97b4", active: "History" },
  { key: "KCC-20", route: `/kcc20/${KCC20_ID}`, active: "History" },
];

// The element that holds the History button, and its buttons.
async function tabBar(page: Page) {
  return page
    .getByRole("tab", { name: "History", exact: true })
    .evaluate((h) => {
      const bar = h.parentElement!;
      const buttons = [...bar.children];
      return {
        tag: bar.tagName,
        className: bar.className,
        labels: buttons.map((b) => b.textContent),
        buttons: buttons.map((b) => ({
          tag: b.tagName,
          // aria-controls is present only where real tabpanels exist; it is not part of the shared visual contract
          attributes: b
            .getAttributeNames()
            .filter((n) => n !== "aria-controls")
            .sort(),
          classes: b.className.split(" ").sort(),
        })),
      };
    });
}

for (const s of TABBED) {
  test(`${s.key}: the tabs are History | Token info, as on every tabbed screen`, async ({
    page,
  }) => {
    await open(page, s.route);
    const own = await tabBar(page);
    // Soft: a failure here still shows the others.
    expect.soft(own.tag, s.key).toBe("NAV");
    expect.soft(own.className, s.key).toBe(TABS_NAV);
    expect.soft(own.labels, s.key).toEqual(["History", "Token info"]);
    const inactive = s.active === "History" ? "Token info" : "History";
    const classes = (label: string) =>
      own.buttons[own.labels.indexOf(label)]?.classes.join(" ");
    const expected = (state: string) =>
      [...TAB_BUTTON.split(" "), state].sort().join(" ");
    expect
      .soft(classes(s.active), `${s.key} active ${s.active}`)
      .toBe(expected("bg-daintree-700"));
    expect
      .soft(classes(inactive), `${s.key} inactive ${inactive}`)
      .toBe(expected("bg-transparent"));

    // The same markup on every other tabbed screen, but for the active tab.
    const same = (bar: typeof own) => ({
      ...bar,
      buttons: bar.buttons.map((b) => ({
        ...b,
        classes: b.classes.filter(
          (c) => c !== "bg-daintree-700" && c !== "bg-transparent",
        ),
      })),
    });
    for (const o of TABBED.filter((x) => x.key !== s.key)) {
      await open(page, o.route);
      expect(same(await tabBar(page)), `${s.key} vs ${o.key}`).toEqual(
        same(own),
      );
    }
  });
}

// As on every other tabbed screen, the identity card is Token info only.
test("KCC-20 screen: Token info shows the name and the Balance row of the row", async ({
  page,
}) => {
  await open(page, `/kcc20/${KCC20_ID}`);
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  // tests/asset-detail/stubs.tsx: 1,000,000 base units, 2 decimals.
  await expect(panel.getByText("Kastle test", { exact: true })).toBeVisible();
  await expect(panel.getByText("Balance", { exact: true })).toBeVisible();
  // As mobile: the holding carries its ticker.
  await expect(panel.getByText("10,000 KTEST", { exact: true })).toBeVisible();
});

test("KCC-20 screen: the Balance row masks with balances hidden, and a scale-less holding keeps one unit", async ({
  page,
}) => {
  const balanceRow = () =>
    page
      .getByRole("tabpanel")
      .locator("section > div > div", { hasText: /^Balance/ });
  await open(page, `/kcc20/${KCC20_ID}`, "&hidden=1");
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  await expect(balanceRow()).toHaveText("Balance*****");

  await open(page, `/kcc20/${KCC20_ID}`, "&nodecimals=1");
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  await expect(balanceRow()).toHaveText("Balance1,000,000 base units");
});

test("KCC-20 screen: no row for the id, no Balance row and no name", async ({
  page,
}) => {
  await open(page, `/kcc20/${"ef".repeat(32)}`);
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Network", { exact: true })).toBeVisible();
  await expect(panel.getByText("Balance", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Kastle test", { exact: true })).toHaveCount(0);
});

test("KCC-20: the identity card shows on Token info, not on History", async ({
  page,
}) => {
  await open(page, `/kcc20/${KCC20_ID}`);
  // The card is the logo, the ticker and the name; its only chip is the KCC-20 badge beside the name.
  const card = page.locator("div.rounded-2xl", {
    has: page.getByText("Kastle test", { exact: true }),
  });
  const chip = page.getByText("Kaspa-KCC20", { exact: true });
  const explorer = page.getByRole("button", {
    name: "See activity history in explorer",
  });
  // History is the kascov list through the page's history slot.
  // The designed row: title, "TX Hash" with its count, the bare signed amount.
  const row = page.getByRole("button", {
    name: /^Received.*TX Hash\s*1\s*\+1\b/,
  });
  await expect(row).toBeVisible();
  await expect(explorer).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(chip).toHaveCount(0);
  // History starts with the list, right under the tabs.
  const next = await page
    .getByRole("tablist")
    .evaluate((nav) => nav.parentElement!.nextElementSibling!.textContent);
  expect(next).toMatch(/^Received/);
  await expect(sendButton(page, "KTEST")).toBeVisible();

  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  await expect(card).toBeVisible();
  await expect(card.getByText("KTEST", { exact: true })).toBeVisible();
  await expect(chip).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(explorer).toHaveCount(0);
  await expect(sendButton(page, "KTEST")).toBeVisible();
});

// Page 1 is an events fallback page with nothing of the wallet's: the list still
// pages, and the row on page 2 lands with the cap's notice under it.
test('KCC-20: an empty fallback page is not "No history yet", and paging continues', async ({
  page,
}) => {
  const errors = await open(page, `/kcc20/${KCC20_ID}`, "&historyFallback=1");
  await expect(
    page.getByRole("button", { name: /^Received.*TX Hash\s*1\s*\+1\b/ }),
  ).toBeVisible();
  await expect(page.getByText("Older history is not shown.")).toBeVisible();
  await expect(page.getByText("No history yet.")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Storybook renders the page with no history slot: History is the explorer link.
test("KCC-20: with no history slot, History falls back to the explorer link", async ({
  page,
}) => {
  await open(page, "/token-detail-no-history");
  const explorer = page.getByRole("button", {
    name: "See activity history in explorer",
  });
  await expect(explorer).toBeVisible();
  await expect(explorer).toBeEnabled();
  await expect(page.getByText("Kaspa-KCC20", { exact: true })).toHaveCount(0);
});

for (const t of [
  { key: "dotK", route: `/dotk/${LONG_DOTK}`, title: LONG_DOTK },
  {
    key: "KRC-20 issue mode",
    route: `/token-asset/${ISSUE_CA}`,
    title: ISSUE_NAME,
  },
]) {
  test(`${t.key}: a long title renders in full`, async ({ page }) => {
    await open(page, t.route);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(t.title);
    // It wraps inside the top bar: the title box stays in the popup, and
    // Close stays to its right, in the popup.
    const popup = (await page.locator("#popup").boundingBox())!;
    const title = (await heading.boundingBox())!;
    expect(title.x).toBeGreaterThanOrEqual(popup.x);
    expect(title.x + title.width).toBeLessThanOrEqual(popup.x + popup.width);
    const close = (await page
      .getByRole("button", { name: "Close" })
      .boundingBox())!;
    expect(close.x).toBeGreaterThanOrEqual(title.x + title.width);
    expect(close.x + close.width).toBeLessThanOrEqual(popup.x + popup.width);
  });
}

// Token detail, as mobile: tabs, the five Token info rows, the movement row
// and the activity sheet, in the extension's own chrome.
test("KCC-20: both tabs render, switch on click and on arrow keys", async ({
  page,
}) => {
  const errors = await open(page, "/token-detail-info");
  const info = page.getByRole("tab", { name: "Token info", exact: true });
  const history = page.getByRole("tab", { name: "History", exact: true });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(info).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Covenant ID");

  await history.click();
  await expect(history).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("history body");

  await history.press("ArrowRight");
  await expect(info).toHaveAttribute("aria-selected", "true");
  await expect(info).toBeFocused();
  await info.press("Home");
  await expect(history).toHaveAttribute("aria-selected", "true");
  // One tab stop: the unselected tab is out of the tab order.
  await expect(info).toHaveAttribute("tabindex", "-1");
  expect(errors).toEqual([]);
});

test("KCC-20: Token info shows the identity block, then mobile's five rows", async ({
  page,
}) => {
  await open(page, "/token-detail-info");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Whale Token");
  const rows = await panel
    .locator("section > div > div")
    .evaluateAll((els) =>
      els.map((el) => [...el.children].map((c) => c.textContent?.trim())),
    );
  expect(rows.slice(0, 5)).toEqual([
    ["Network", "Kaspa"],
    ["Standard", "KCC-20"],
    ["Balance", "128,001 WHALE"],
    ["Decimals", "0"],
    ["Covenant ID", "ca8a8ed8…94c04"],
  ]);
  const id = panel.getByText("ca8a8ed8…94c04", { exact: true });
  const font = await id.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toMatch(/mono/i);
  await expect(sendButton(page, "WHALE")).toBeVisible();
});

test("KCC-20: a movement row shows a title, TX Hash and a signed amount, never the txid", async ({
  page,
}) => {
  await open(page, `/kcc20/${KCC20_ID}`);
  const row = page.getByRole("button", { name: /^Received/ });
  await expect(row).toBeVisible();
  const text = (await row.textContent())!;
  expect(text).toMatch(/TX Hash\s*1/);
  // The page names the token: the amount carries no symbol.
  expect(text).toMatch(/\+1(?!\s*KTEST)/);
  expect(text).not.toMatch(/KTEST/);
  // No counterparty and no date on the designed row.
  expect(text).not.toMatch(/From qsender/);
  expect(text).not.toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
  expect(text).not.toMatch(/[0-9a-f]{16}/);
  expect(text).not.toMatch(/Unknown|Unavailable|—/);
});

test("KCC-20 activity sheet: Status shows only when the feed supplies it", async ({
  page,
}) => {
  await open(page, "/kcc20-activity");
  const sheet = page.getByRole("dialog", { name: "TX Hash" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("TX ID");
  await expect(sheet.getByText("Status", { exact: true })).toHaveCount(0);
  await expect(sheet).not.toContainText(/Unknown|Unavailable|—/);
  await expect(
    sheet.getByRole("button", { name: "View on Explorer" }),
  ).toBeVisible();

  // The shared status vocabulary is closed: a feed answers one of HistoryStatus.
  await open(page, "/kcc20-activity", "&status=finalized");
  await expect(sheet.getByText("Status", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Finalized", { exact: true })).toBeVisible();

  // The token-history sheet opens kascov, which decodes the KCC-20 action.
  await sheet.getByRole("button", { name: "View on Explorer" }).click();
  const opened = await page.evaluate(
    () => (window as unknown as { __opened?: string[] }).__opened ?? [],
  );
  expect(opened).toHaveLength(1);
  expect(opened[0].startsWith("https://kascov.io/#/mainnet/tx/")).toBe(true);
  expect(opened[0]).not.toContain("explorer.kaspa.org");
});

test("KCC-20 activity sheet: copy puts the full txid on the clipboard and says so", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (t: string) => {
          (window as unknown as { __clipText: string }).__clipText = t;
          return Promise.resolve();
        },
      },
    });
  });
  await open(page, "/kcc20-activity");
  const txid = "0123456789abcdef".repeat(4);
  const sheet = page.getByRole("dialog", { name: "TX Hash" });
  // Truncated on screen, full on copy.
  await expect(sheet.getByText(txid, { exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Copy TX ID" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __clipText: string }).__clipText,
    ),
  ).toBe(txid);
  await expect(sheet.getByRole("status")).toHaveText("TX ID copied");
});

test("KCC-20 activity sheet: focus stays inside and Escape closes it", async ({
  page,
}) => {
  await open(page, "/kcc20-activity");
  const sheet = page.getByRole("dialog", { name: "TX Hash" });
  const copy = sheet.getByRole("button", { name: "Copy TX ID" });
  const explorer = sheet.getByRole("button", { name: "View on Explorer" });
  await expect(copy).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(explorer).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(copy).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(explorer).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("closed")).toBeVisible();
});

// In-app EVM history (Blockscout, stubbed in tests/asset-detail/stubs.tsx).
// Kasplex mainnet has an apiUrl; 0x1 is no chain in lib/layer2, so none.
const KASPLEX = "0x3173b";
const KASPLEX_EXPLORER = "https://explorer.kasplex.org/tx/";
const EVM_TX_HASH = `0x${"a1".repeat(32)}`;
const ERC20_TX_HASH = `0x${"b2".repeat(32)}`;
const openedTab = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __openedTab?: string }).__openedTab,
  );

test("EVM KAS: History lists the Blockscout txs in-app, a row opens the sheet, and the sheet opens the explorer", async ({
  page,
}) => {
  const errors = await open(page, `/evm-asset/${KASPLEX}`);
  const row = page.getByRole("button", { name: /Sent/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("1.5");
  await row.click();
  const sheet = page.getByRole("dialog", { name: "TX Hash" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("TX ID");
  // The tap opens the sheet, not the explorer: that is one tap deeper.
  expect(await openedTab(page)).toBeUndefined();
  await sheet.getByRole("button", { name: "View on Explorer" }).click();
  expect(await openedTab(page)).toBe(KASPLEX_EXPLORER + EVM_TX_HASH);
  expect(errors).toEqual([]);
});

test("ERC-20: opens on History, lists the token's transfers, a row opens the sheet, and the sheet opens the explorer", async ({
  page,
}) => {
  const errors = await open(page, `/erc20-asset/${KASPLEX}/${ERC20}`);
  await expect(
    page.getByRole("tab", { name: "History", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const row = page.getByRole("button", { name: /Received/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2.5");
  await row.click();
  const sheet = page.getByRole("dialog", { name: "TX Hash" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("TX ID");
  // The tap opens the sheet, not the explorer: that is one tap deeper.
  expect(await openedTab(page)).toBeUndefined();
  await sheet.getByRole("button", { name: "View on Explorer" }).click();
  expect(await openedTab(page)).toBe(KASPLEX_EXPLORER + ERC20_TX_HASH);
  expect(errors).toEqual([]);
});

test("ERC-20: the History tab is reachable by click from Token info", async ({
  page,
}) => {
  await open(page, `/erc20-asset/${KASPLEX}/${ERC20}`);
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  await expect(page.getByRole("button", { name: /Received/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: /Received/ })).toBeVisible();
});

for (const route of ["/evm-asset/0x1", `/erc20-asset/0x1/${ERC20}`]) {
  test(`${route}: a chain with no apiUrl shows the reason and no rows`, async ({
    page,
  }) => {
    await open(page, route);
    await expect(
      page.getByText("History is not available for this network"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Sent|Received/ }),
    ).toHaveCount(0);
  });
}

test("ERC-20, Blockscout down: error and Retry, and Retry calls the endpoint again", async ({
  page,
}) => {
  await open(page, `/erc20-asset/${KASPLEX}/${ERC20}`, "&evmHistoryDown=1");
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText("No history yet")).toHaveCount(0);
  const calls = () =>
    page.evaluate(
      () =>
        (window as unknown as { __evmHistoryCalls?: number })
          .__evmHistoryCalls ?? 0,
    );
  const before = await calls();
  expect(before).toBeGreaterThan(0);
  await retry.click();
  await expect.poll(calls).toBeGreaterThan(before);
});

test("history shell: one request per load cycle, none per re-render, cap after three empty pages", async ({
  page,
}) => {
  await open(page, "/history-paging");
  const w = (fn: string) =>
    page.evaluate(
      (f) => (window as unknown as Record<string, () => void>)[f](),
      fn,
    );
  const requests = () =>
    page.evaluate(
      () => (window as unknown as { __requests: number }).__requests,
    );
  const loadMore = page.getByRole("button", { name: "Load more" });
  // Sentinel in view: exactly one request, and re-renders before the load
  // starts (fresh onLoadMore each time) add none.
  await expect.poll(requests).toBe(1);
  for (let i = 0; i < 3; i++) await w("__rerender");
  await page.waitForTimeout(300);
  expect(await requests()).toBe(1);
  // Each empty page that completes earns exactly one further request, until
  // three in a row have loaded automatically.
  for (const expected of [2, 3]) {
    await w("__start");
    await w("__rerender");
    await w("__finish");
    await expect.poll(requests).toBe(expected);
    await w("__rerender");
    await page.waitForTimeout(300);
    expect(await requests()).toBe(expected);
  }
  // Third empty page lands: no fourth automatic request, the button instead.
  await w("__start");
  await w("__finish");
  await expect(loadMore).toBeVisible();
  await w("__rerender");
  await page.waitForTimeout(500);
  expect(await requests()).toBe(3);
  // The button asks for exactly one page.
  await loadMore.click();
  expect(await requests()).toBe(4);
  await w("__rerender");
  await page.waitForTimeout(300);
  expect(await requests()).toBe(4);
});

test('history shell: hasMore false with a page in flight is a spinner, never "No history yet"', async ({
  page,
}) => {
  await open(page, "/history-paging", "&inflight=1");
  await expect(page.getByRole("status", { name: "loading" })).toBeVisible();
  await expect(page.getByText("No history yet.")).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __finish: () => void }).__finish(),
  );
  await expect(page.getByText("No history yet.")).toBeVisible();
});

test('EVM KAS: pages of dropped calls are never "No history yet" while more exist', async ({
  page,
}) => {
  // Latch the empty copy if it ever paints, even for one frame between pages.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.innerText.includes("No history yet"))
        (window as unknown as { __sawEmpty?: boolean }).__sawEmpty = true;
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const sawEmpty = () =>
    page.evaluate(
      () => !!(window as unknown as { __sawEmpty?: boolean }).__sawEmpty,
    );
  await open(page, `/evm-asset/${KASPLEX}`, "&evmHistoryCalls=1");
  // In flight (page 1, then the backfill): a spinner, no empty copy.
  await expect(
    page.getByRole("status", { name: "loading" }).first(),
  ).toBeVisible();
  // Backfill cap reached, source still has more: the sentinel under the
  // spinner asks for the next page by itself, but only for a bounded run of
  // pages that add no rows; then a Load more button takes over.
  const calls = () =>
    page.evaluate(
      () =>
        (window as unknown as { __evmHistoryCalls?: number })
          .__evmHistoryCalls ?? 0,
    );
  const loadMore = page.getByRole("button", { name: "Load more" });
  const rows = page.getByRole("button", { name: /Sent|Received/ });
  // Page 1 + the backfill make 5 calls; the sentinel then adds 3 empty pages
  // (the cap). Every page past the first costs 2 calls: SWR refetches page 1
  // with each setSize (useEvmHistory revalidateFirstPage).
  const PER_PAGE = 2;
  const BOUND = 5 + 3 * PER_PAGE;
  await expect(loadMore).toBeVisible({ timeout: 15_000 });
  expect(await calls()).toBe(BOUND);
  await page.waitForTimeout(2_000);
  expect(await calls()).toBe(BOUND);
  await expect(rows).toHaveCount(0);
  expect(await sawEmpty()).toBe(false);
  // One press, one page; still empty, so the button comes straight back.
  await loadMore.click();
  await expect.poll(calls).toBe(BOUND + PER_PAGE);
  await expect(loadMore).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(await calls()).toBe(BOUND + PER_PAGE);
  // Pages now move value: one press yields a row and restores auto-paging,
  // so further pages load with no press and no button.
  await page.evaluate(() => {
    (window as unknown as { __evmHistoryValue?: boolean }).__evmHistoryValue =
      true;
  });
  await loadMore.click();
  await expect(rows.first()).toBeVisible();
  await expect.poll(async () => rows.count()).toBeGreaterThan(1);
  await expect.poll(calls).toBeGreaterThan(BOUND + 2 * PER_PAGE);
  await expect(loadMore).toHaveCount(0);
  expect(await sawEmpty()).toBe(false);
});

test("EVM KAS: a revalidation shows a new transfer on top, and the old row never blanks", async ({
  page,
}) => {
  // Latch if the old row ever disappears, even for one frame mid-refetch.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const w = window as unknown as {
        __sawOld?: boolean;
        __lostOld?: boolean;
      };
      const has = !!document.body?.innerText.includes("1.5");
      if (has) w.__sawOld = true;
      else if (w.__sawOld) w.__lostOld = true;
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await open(page, `/evm-asset/${KASPLEX}`);
  const rows = page.getByRole("button", { name: /Sent/ });
  await expect(rows).toHaveCount(1);
  // SWR ignores focus for 5 s after mount (focusThrottleInterval); past it,
  // focus runs the same first-page revalidation a reopen runs on a cached key.
  await page.waitForTimeout(5_100);
  await page.evaluate(() => {
    (window as unknown as { __evmHistoryNewTx?: boolean }).__evmHistoryNewTx =
      true;
    window.dispatchEvent(new Event("focus"));
  });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("3");
  expect(
    await page.evaluate(
      () => !!(window as unknown as { __lostOld?: boolean }).__lostOld,
    ),
  ).toBe(false);
});

// The History list starts the asset pages' section gap (mt-8 = 32 px)
// below the tab bar, as the real Info tabs do. The harness stubs the
// Info tabs and KasHistory, so the gap is checked as a number.
const SECTION_GAP = 32;
const gapBelowTabs = (page: Page) =>
  page.evaluate(() => {
    let tabs = document.querySelector('[role="tablist"]') as HTMLElement;
    while (!tabs.parentElement!.classList.contains("overflow-y-auto"))
      tabs = tabs.parentElement!;
    const body = tabs.nextElementSibling as HTMLElement;
    return (
      body.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom
    );
  });

for (const s of [
  { key: "ERC-20", route: `/erc20-asset/${KASPLEX}/${ERC20}`, row: /Received/ },
  { key: "EVM KAS", route: `/evm-asset/${KASPLEX}`, row: /Sent/ },
]) {
  test(`${s.key}: History list starts the section gap below the tabs`, async ({
    page,
  }) => {
    await open(page, s.route);
    await expect(page.getByRole("button", { name: s.row })).toBeVisible();
    expect(await gapBelowTabs(page)).toBe(SECTION_GAP);
  });

  // While page 1 loads, HistoryList's root is the Spinner, centred by
  // `self-center`. The gap wrapper must be a flex COLUMN: the cross axis
  // carries the spinner's `self-center`, and the column axis keeps the list
  // full width. A row flex box would left-align the spinner and shrink the list.
  test(`${s.key}: History wrapper is a flex column so the loading spinner stays centred`, async ({
    page,
  }) => {
    await open(page, s.route);
    await expect(page.getByRole("button", { name: s.row })).toBeVisible();
    const cs = await page.evaluate(() => {
      let tabs = document.querySelector('[role="tablist"]') as HTMLElement;
      while (!tabs.parentElement!.classList.contains("overflow-y-auto"))
        tabs = tabs.parentElement!;
      const style = getComputedStyle(tabs.nextElementSibling as HTMLElement);
      return [style.display, style.flexDirection];
    });
    expect(cs).toEqual(["flex", "column"]);
  });
}
