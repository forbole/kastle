import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Never ./history-surfaces/stubs: it pulls repo modules (and their SVGs)
// that this Node loader cannot parse.
import {
  EVM_CHAIN,
  EVM_TOKEN,
  EVM_TOKEN_LOGO,
} from "./history-surfaces/constants";

// Every per-asset history renders through the shared HistoryList/HistoryRow/
// HistoryDetail. The harness in tests/history-surfaces mounts the four real
// surfaces over stubbed data sources, each answering the same six row shapes.

type Row = {
  title: string;
  line: string | null;
  amount: string | null;
  time: boolean;
};
type Sheet = {
  row: number;
  status: string | null;
  value: boolean;
  txid: boolean;
  explorer: boolean;
};
type Surface = {
  key: string;
  route: string;
  rows: Row[];
  sheets: Sheet[];
  // The screen passes getRowExtras: logo, "TX Hash" + count, no symbol, no date.
  designed?: boolean;
  // Designed rows with an amount carry a fiat value: the fiat line is required.
  fiat?: boolean;
  // The token logo the row must show, when the harness pins one.
  logo?: string;
  kasplexBadge?: boolean;
};

const row = (
  title: string,
  line: string | null,
  amount: string | null,
  time = true,
): Row => ({ title, line, amount, time });

// A designed row: under the title the "TX Hash" label and its count, the amount
// without the page's symbol, and no date (it lives in the TX Hash card).
// A null count is a row with nothing on chain: "TX Hash" with no badge.
const designedRow = (
  title: string,
  amount: string | null,
  txCount: number | null = 1,
): Row => ({
  title,
  line: `TX Hash${txCount ?? ""}`,
  amount,
  time: false,
});

// Fixture order per tests/history-surfaces/stubs.tsx: out, in, self, no
// amount, no time, no counterparty. KAS cannot lack an amount and KCC-20
// cannot lack a time; those shapes are absent from their lists.
const SURFACES: Surface[] = [
  {
    key: "kas",
    route: "/kas",
    rows: [
      designedRow("Sent", "-250"),
      designedRow("Received", "+100"),
      // Self shows the own outputs that came back, never the fee-only net.
      designedRow("Self transfer", "100"),
      designedRow("Received", "+5"),
      designedRow("Sent", "-30"),
    ],
    designed: true,
    fiat: true,
    sheets: [
      { row: 0, status: "Finalized", value: true, txid: true, explorer: true },
    ],
  },
  {
    key: "krc20",
    route: "/krc20/KASPY",
    rows: [
      // Commit and reveal both confirmed: two transactions per row.
      designedRow("Sent", "-1", 2),
      designedRow("Received", "+2.5", 2),
      designedRow("Self transfer", "1", 2),
      designedRow("Received", null, 2),
      designedRow("Received", "+1", 2),
      // No reveal hash: nothing on chain to count.
      designedRow("Sent", "-1", null),
    ],
    designed: true,
    sheets: [
      { row: 0, status: "Finalized", value: false, txid: true, explorer: true },
      // No hash: nothing to copy, nowhere to link.
      {
        row: 5,
        status: "Finalized",
        value: false,
        txid: false,
        explorer: false,
      },
    ],
  },
  {
    key: "kcc20",
    route: "/kcc20",
    rows: [
      designedRow("Sent", "-2.5"),
      designedRow("Received", "+1"),
      designedRow("Self transfer", "0.5"),
      designedRow("Sent", null),
      designedRow("Received", "+0.7"),
    ],
    designed: true,
    sheets: [
      { row: 0, status: null, value: false, txid: true, explorer: true },
    ],
  },
  {
    // The real EVM KAS screen: KAS logo on its L2 badge, one tx per row.
    key: "evm-kas",
    kasplexBadge: true,
    route: `/evm-kas/${EVM_CHAIN}`,
    rows: [
      designedRow("Sent", "-1.5"),
      designedRow("Received", "+1.5"),
      designedRow("Self transfer", "0.5"),
      designedRow("Contract deploy", null),
      designedRow("Received", "+1.5"),
      designedRow("Received", "+1.5"),
    ],
    designed: true,
    sheets: [
      { row: 0, status: "Finalized", value: false, txid: true, explorer: true },
    ],
  },
  {
    // The real ERC-20 screen: the token's own image on its L2 badge.
    key: "erc20",
    kasplexBadge: true,
    route: `/erc20/${EVM_CHAIN}/${EVM_TOKEN}`,
    rows: [
      designedRow("Sent", "-1.5"),
      designedRow("Received", "+1.5"),
      designedRow("Self transfer", "0.5"),
      designedRow("Contract deploy", null),
      designedRow("Received", "+1.5"),
      designedRow("Received", "+1.5"),
    ],
    designed: true,
    logo: EVM_TOKEN_LOGO,
    sheets: [
      { row: 0, status: "Finalized", value: false, txid: true, explorer: true },
    ],
  },
  {
    key: "evm",
    route: "/evm",
    rows: [
      row("Sent", "To 0x222222...22222", "-1.5 KAS"),
      row("Received", "From 0x222222...22222", "+1.5 KAS"),
      row("Self transfer", null, "0.5 KAS"),
      row("Contract deploy", null, null),
      row("Received", "From 0x222222...22222", "+1.5 KAS", false),
      row("Received", null, "+1.5 KAS"),
    ],
    sheets: [
      { row: 0, status: "Finalized", value: false, txid: true, explorer: true },
    ],
  },
];

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-history-surfaces-${process.pid}`);
  // vite.build sets NODE_ENV=production in the worker; restore it for the
  // React specs that run after in the same worker.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/history-surfaces/vite.config.mjs"),
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
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto(
    `${base}/?route=${encodeURIComponent(route)}${query ? `&${query}` : ""}`,
  );
  return errors;
}

async function shoot(page: Page, name: string) {
  const file = test.info().outputPath(name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`PNG ${file}`);
}

// A history row: a button with the growing title column, which both the
// legacy row (direction circle) and the designed row (logo) have.
const rowsOf = (page: Page) =>
  page.locator("#popup button:has(> div.flex-grow)");

for (const [i, s] of SURFACES.entries()) {
  test(`${s.key}: rows render the shared shape, sheet shows only what is known`, async ({
    page,
  }) => {
    const errors = await open(page, s.route);
    const rows = rowsOf(page);
    await expect(rows).toHaveCount(s.rows.length);

    const read = await rows.evaluateAll((bs) =>
      bs.map((b) => {
        const [circle, left, right] = [...b.children] as HTMLElement[];
        const imgs = [...circle.querySelectorAll("img")];
        return {
          circleSvg: !!circle.querySelector("svg"),
          imgs: b.querySelectorAll("img").length,
          // AssetImage: the token circle's image, then the corner badge.
          logoSrc: imgs.find((i) => !i.classList.contains("absolute"))?.src,
          badgeSrc: imgs.find((i) => i.classList.contains("absolute"))?.src,
          left: [...left.children].map((c) => c.textContent ?? ""),
          leftGrow: left.classList.contains("flex-grow"),
          rightClass: right.className,
          right: [...right.children].map((c) => c.textContent ?? ""),
        };
      }),
    );

    const badge = await page.evaluate(
      () =>
        new URL(
          (window as unknown as { __kasplexBadge: string }).__kasplexBadge,
          location.href,
        ).href,
    );
    for (const [n, want] of s.rows.entries()) {
      const got = read[n];
      const at = `${s.key} row ${n}`;
      if (s.designed) {
        // Token logo with its chain badge in place of the direction circle.
        expect(got.circleSvg, at).toBe(false);
        expect(got.badgeSrc, at).toMatch(/^(data:image|http)/);
        // On the EVM screens: the Kasplex mark the harness entry resolved.
        if (s.kasplexBadge) expect(got.badgeSrc, at).toBe(badge);
        expect(got.logoSrc, at).toMatch(/^(data:image|http)/);
        if (s.logo) expect(got.logoSrc, at).toBe(s.logo);
      } else {
        // The direction circle, never a logo or the family's old markup.
        expect(got.circleSvg, at).toBe(true);
        expect(got.imgs, at).toBe(0);
      }
      expect(got.leftGrow, at).toBe(true);
      expect(got.left, at).toEqual(
        want.line === null ? [want.title] : [want.title, want.line],
      );
      expect(got.rightClass, at).toContain("items-end");
      if (s.designed) {
        // Amount over the fiat value; no date cell on the designed row. A
        // record with a fiat value must show it; one without shows nothing.
        const hasFiat = !!s.fiat && want.amount !== null;
        expect(got.right.length, at).toBe(
          (want.amount === null ? 0 : 1) + (hasFiat ? 1 : 0),
        );
        if (want.amount !== null) expect(got.right[0], at).toBe(want.amount);
        if (hasFiat) expect(got.right[1], at).toMatch(/^≈ \$[\d,.]+ USD$/);
        continue;
      }
      // Amount over time, both in the right-hand column.
      const expected = [
        ...(want.amount === null ? [] : [want.amount]),
        ...(want.time ? ["time"] : []),
      ];
      expect(got.right.length, at).toBe(expected.length);
      if (want.amount !== null) expect(got.right[0], at).toBe(want.amount);
      if (want.time) {
        const time = got.right[got.right.length - 1];
        expect(time, at).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, /);
        expect(time, at).not.toContain("≈");
      }
      // No placeholder where the amount is unknown.
      if (want.amount === null)
        for (const t of got.right) expect(t, at).not.toMatch(/^[-–—0]$|^0 /);
    }
    await expect(page.locator("#popup")).not.toContainText("No history yet.");
    await shoot(page, `0${i + 1}-${s.key}-history.png`);

    for (const sh of s.sheets) {
      await rows.nth(sh.row).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "TX Hash" }),
      ).toBeVisible();
      const time = await dialog
        .getByRole("heading", { name: "TX Hash" })
        .evaluate((h) => h.nextElementSibling?.textContent ?? "");
      expect(time).not.toContain("≈");
      const labels = await dialog
        .locator("div.justify-between > span:first-child")
        .allTextContents();
      expect(labels, `${s.key} sheet ${sh.row}`).toEqual([
        ...(sh.status ? ["Status"] : []),
        ...(sh.value ? ["Value"] : []),
        ...(sh.txid ? ["TX ID"] : []),
      ]);
      if (sh.status) await expect(dialog).toContainText(sh.status);
      if (sh.value) await expect(dialog).toContainText("≈ $");
      await expect(
        dialog.getByRole("button", { name: "View on Explorer" }),
      ).toHaveCount(sh.explorer ? 1 : 0);
      if (s.key === "kcc20") await shoot(page, "05-detail-kcc20.png");
      if (s.key === "kas") await shoot(page, "06-detail-kas-value.png");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test(`${s.key}: "No history yet." only when nothing is in flight and no page remains`, async ({
    page,
  }) => {
    const errors = await open(page, s.route, "state=empty");
    await expect(page.locator("#popup")).toContainText("No history yet.");
    await expect(rowsOf(page)).toHaveCount(0);
    if (s.key === "kas") await shoot(page, "07-empty.png");

    // A page remains: a spinner, not an empty verdict.
    await open(page, s.route, "state=more");
    await expect(page.getByRole("status", { name: "loading" })).toBeVisible();
    await expect(page.locator("#popup")).not.toContainText("No history yet.");

    // Page 1 in flight.
    await open(page, s.route, "state=loading");
    await expect(page.getByRole("status", { name: "loading" })).toBeVisible();
    await expect(page.locator("#popup")).not.toContainText("No history yet.");
    if (s.key === "kas") await shoot(page, "08-loading.png");
    expect(errors).toEqual([]);
  });
}

// The token page hides the ticker, but "base units" is not a ticker: without
// it an unscaled 100,000,000 reads as 100 million whole tokens.
test("krc20: unknown decimals keep the base-units label on the token page", async ({
  page,
}) => {
  const errors = await open(page, "/krc20/RAW");
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(6);
  // Row 5: in from BOB, default amt "100000000".
  await expect(rows.nth(4)).toContainText("+100,000,000 base units");
  expect(errors).toEqual([]);
});

// React Router keeps a route element mounted across a param change, so the
// list's paging state (empty-page streak, phase) must be reset by its key.
test("krc20: the TX Hash card shows Committed and Revealed, done only when the op proves them", async ({
  page,
}) => {
  const errors = await open(page, "/krc20/KASPY");
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(6);
  const card = page.getByRole("tooltip");
  const readCard = async (n: number) => {
    // Close the previous row's card first, so the read below is this row's.
    await page.mouse.move(0, 0);
    await expect(card).toHaveCount(0);
    await rows
      .nth(n)
      .locator("span", { hasText: /^TX Hash/ })
      .first()
      .hover();
    await expect(card).toHaveCount(1);
    return card.locator("li").evaluateAll((lis) =>
      lis.map((li) => ({
        label: li.textContent ?? "",
        isDone: /check/.test(
          li.querySelector("svg")?.getAttribute("class") ?? "",
        ),
        href: li.querySelector("a")?.getAttribute("href") ?? null,
      })),
    );
  };

  // Revealed: both steps done, Revealed links to the reveal on the explorer.
  const revealed = await readCard(0);
  expect(revealed.map((l) => [l.label, l.isDone])).toEqual([
    ["Committed", true],
    ["Revealed", true],
  ]);
  expect(revealed[0].href).toBeNull();
  expect(revealed[1].href).toMatch(/^https?:\/\/.+[0-9a-f]{16}/);
  await expect(
    card.getByRole("link", { name: "Revealed on explorer" }),
  ).toHaveCount(1);

  // No hash: nothing on chain, so neither step is done and nothing links.
  await page.mouse.move(0, 0);
  const unknown = await readCard(5);
  expect(unknown.map((l) => [l.label, l.isDone, l.href])).toEqual([
    ["Committed", false, null],
    ["Revealed", false, null],
  ]);
  expect(errors).toEqual([]);
});

test("krc20: switching ticker remounts the list, a capped source never caps the next", async ({
  page,
}) => {
  const errors = await open(page, "/krc20/KASPY", "state=pager");
  const loadMore = page.getByRole("button", { name: "Load more" });
  const pages = () =>
    page.evaluate(
      () =>
        (window as unknown as { __pagesRequested: number }).__pagesRequested,
    );
  // Three empty pages in a row cap auto-paging behind the button.
  await expect(loadMore).toBeVisible();
  expect(await pages()).toBe(3);

  await page.evaluate(() =>
    (
      window as unknown as { __harnessNavigate: (to: string) => void }
    ).__harnessNavigate("/krc20/NACHO"),
  );
  // A fresh list pages on its own again: without the key the stale streak
  // keeps the button up and no request is ever made.
  await expect.poll(pages).toBe(6);
  await expect(loadMore).toBeVisible();
  expect(errors).toEqual([]);
});

// A source that serves a cached page flips no flag and adds no row; without
// the stall escape the request never ends and the list spins forever.
test("evm: a request that changes nothing ends at Load more, not a stuck spinner", async ({
  page,
}) => {
  const errors = await open(page, "/evm", "state=stall");
  const pages = () =>
    page.evaluate(
      () =>
        (window as unknown as { __pagesRequested: number }).__pagesRequested,
    );
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible({
    timeout: 15_000,
  });
  expect(await pages()).toBe(3);
  expect(errors).toEqual([]);
});

test("kas: an open sheet follows its record through a refresh", async ({
  page,
}) => {
  const errors = await open(page, "/kas", "state=refresh");
  await rowsOf(page).nth(0).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Pending");
  await page.evaluate(() =>
    (window as unknown as { __finalize: () => void }).__finalize(),
  );
  await expect(dialog).toContainText("Finalized");
  await expect(dialog).not.toContainText("Pending");
  expect(errors).toEqual([]);
});
