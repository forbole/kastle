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

test("KCC-20: Send keeps the ext of the row", async ({ page }) => {
  await open(page, `/kcc20/${KCC20_ID}?ext=${KCC20_EXT}`);
  await sendButton(page, "KTEST").click();
  await expect(page.getByTestId("landed")).toHaveText(
    `/kcc20/send/${KCC20_ID}?ext=${KCC20_EXT}`,
  );
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
