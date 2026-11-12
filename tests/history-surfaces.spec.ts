import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
};

const row = (
  title: string,
  line: string | null,
  amount: string | null,
  time = true,
): Row => ({ title, line, amount, time });

// A designed row: under the title the "TX Hash" label and its count, the amount
// without the page's symbol, and no date (it lives in the TX Hash card).
const designedRow = (
  title: string,
  amount: string | null,
  txCount = 1,
): Row => ({ title, line: `TX Hash${txCount}`, amount, time: false });

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
      // No reveal hash: the commit is not known to be confirmed, one step.
      designedRow("Sent", "-1", 1),
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
        return {
          circleSvg: !!circle.querySelector("svg"),
          imgs: b.querySelectorAll("img").length,
          left: [...left.children].map((c) => c.textContent ?? ""),
          leftGrow: left.classList.contains("flex-grow"),
          rightClass: right.className,
          right: [...right.children].map((c) => c.textContent ?? ""),
        };
      }),
    );

    for (const [n, want] of s.rows.entries()) {
      const got = read[n];
      const at = `${s.key} row ${n}`;
      if (s.designed) {
        // Token logo with its chain badge in place of the direction circle.
        expect(got.imgs, at).toBeGreaterThan(0);
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
        // Amount over the fiat value; no date cell on the designed row.
        const rest = want.amount === null ? got.right : got.right.slice(1);
        if (want.amount !== null) expect(got.right[0], at).toBe(want.amount);
        for (const t of rest) expect(t, at).toMatch(/^≈ \$[\d,.]+ USD$/);
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

// React Router keeps a route element mounted across a param change, so the
// list's paging state (empty-page streak, phase) must be reset by its key.
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
