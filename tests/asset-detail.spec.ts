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
    await expect(sendButton(page, s.ticker)).toHaveText(`Send ${s.ticker}`);
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

  test(`${s.key}: nothing to send hides Send`, async ({ page }) => {
    await open(page, s.route, "&empty=1");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Send / })).toHaveCount(0);
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

// Ledger cannot sign KRC-20, EVM or covenant transactions; KAS it can.
// KCC-20 is left out: its route guard keeps a Ledger off the page.
test("a Ledger wallet sees Send only on KAS", async ({ page }) => {
  for (const s of SCREENS.filter((x) => x.key !== "KCC-20")) {
    await open(page, s.route, "&ledger=1");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sendButton(page, s.ticker)).toHaveCount(
      s.key === "KAS" ? 1 : 0,
    );
  }
});
