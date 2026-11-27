import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real Activity screen, built by tests/activity-money/vite.config.mjs
// with the QA wallet's swap rows of 2026-11-26 (tests/activity-money/stubs.tsx)
// and the prices each source answered that day. Every number read here went
// through the real mappers, adapters, price resolution and formatters.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-activity-money-${process.pid}`);
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/activity-money/vite.config.mjs"),
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

/** Opens Activity in a 375×600 popup; returns the page errors it collects. */
async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto(base);
  await expect(page.getByText("+18,922")).toBeVisible();
  return errors;
}

/** Each list row's lines, top to bottom, e.g. ["Swapped", "26 Nov｜14:06", "+18,922 PEPE", "≈ $0.05 USD"]. */
async function rows(page: Page): Promise<string[][]> {
  return page.locator("button:has(> div.relative.size-10)").evaluateAll((els) =>
    els.map((el) =>
      (el as HTMLElement).innerText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

async function body(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  console.log(`BODY ─────\n${text}\n─────`);
  return text;
}

const row = (all: string[][], amount: string) => {
  const r = all.find((cells) => cells.some((c) => c.startsWith(amount)));
  expect(r, `no row ${amount}`).toBeTruthy();
  return r!;
};

test("item 1: 77,000 KPEPE is valued at its covenant's price, as on the dashboard", async ({
  page,
}) => {
  const errors = await open(page);
  await body(page);
  const kpepe = row(await rows(page), "+77,000");
  const usd = kpepe.find((c) => c.startsWith("≈"));
  // 77,000 × 0.00013132628 KAS × $0.02667811 = $0.2698…
  expect(usd).toMatch(/^≈ \$0\.2\d* USD$/);
  expect(kpepe.join(" ")).not.toContain("1,374");
  expect(kpepe.join(" ")).not.toContain("1,381");
  expect(errors).toEqual([]);
});

test("item 2: every row with an amount has a fiat line, or says the price is unavailable", async ({
  page,
}) => {
  const errors = await open(page);
  await body(page);
  const all = await rows(page);
  console.log("ROWS", JSON.stringify(all));
  expect(all.length).toBe(5);
  for (const cells of all) {
    const fiat = cells[cells.length - 1];
    expect(fiat, cells.join(" | ")).toMatch(
      /^(≈ \$[\d,.]+ USD|Price unavailable)$/,
    );
  }
  // KING has no price on either Zealous list: it says so, like its neighbours' lines.
  expect(row(all, "+2,453.555")).toContain("Price unavailable");
  expect(row(all, "+43.5").at(-1)).toMatch(/^≈ \$/);
  expect(errors).toEqual([]);
});

test("item 3: list and sheet fiat lines use two decimals at or above $0.01", async ({
  page,
}) => {
  const errors = await open(page);
  const all = await rows(page);
  console.log("ROWS", JSON.stringify(all));
  const fiat = all.map((c) => c.at(-1)!).filter((c) => c.startsWith("≈"));
  expect(fiat.length).toBe(4);
  for (const line of fiat) expect(line).toMatch(/^≈ \$[\d,]+\.\d{2} USD$/);
  await page.getByText("+18,922").click();
  const sheet = await page.locator("dialog").innerText();
  console.log(`SHEET ─────\n${sheet}\n─────`);
  const sheetFiat = sheet.split("\n").filter((l) => l.startsWith("≈"));
  expect(sheetFiat.length).toBe(2);
  for (const line of sheetFiat) expect(line).not.toMatch(/\.\d{5,}/);
  expect(errors).toEqual([]);
});

test("a named token with no decimals shows its name on the sheet, its amount absent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto(`${base}/?unscaled`);
  await page.getByText("+1.5").click();
  const sheet = await page.locator("dialog").innerText();
  console.log(`SHEET ─────\n${sheet}\n─────`);
  const lines = sheet
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  expect(lines[0]).toBe("Swap GUZA → KAS");
  // The Paid leg: no amount was read, so "-" — but the token is named, not "-".
  const paid = lines.indexOf("Paid");
  expect(lines.slice(paid, paid + 3)).toEqual(["Paid", "-", "GUZA"]);
  // Never "0 GUZA" for an amount nobody read.
  expect(sheet).not.toMatch(/\b0 GUZA\b/);
  expect(errors).toEqual([]);
});

// A missing side reads "-" (as an unread leg amount does); a lone name is kept.
for (const [name, title] of [
  ["both", "Swap KAS → GUZA"],
  ["onlyTo", "Swap - → GUZA"],
  ["onlyFrom", "Swap GUZA → -"],
  ["kasUnread", "Swap GUZA → KAS"],
  ["neither", "Swap"],
] as const) {
  test(`sheet title, ${name}: ${title}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 375, height: 600 });
    await page.goto(`${base}/?case=${name}`);
    await page.locator("button:has(> div.relative.size-10)").first().click();
    const sheet = await page.locator("dialog").innerText();
    console.log(`SHEET ${name} ─────\n${sheet}\n─────`);
    expect(sheet.split("\n")[0].trim()).toBe(title);
    expect(errors).toEqual([]);
  });
}

// Braid round trip (records.ts BRAID): every field of the reference sheet is
// filled, or says why it is not — never blank.
test("Braid buy and sell: list rows carry amount, symbol and fiat; sheets fill every reference field", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto(`${base}/?case=braid`);
  await expect(page.getByText("+8.662")).toBeVisible();
  const all = await rows(page);
  console.log("ROWS", JSON.stringify(all));
  expect(all.length).toBe(3);
  const sheets: string[][] = [];
  for (let i = 0; i < all.length; i++) {
    await page.locator("button:has(> div.relative.size-10)").nth(i).click();
    const text = await page.locator("dialog").innerText();
    console.log(`SHEET ${i} ─────\n${text}\n─────`);
    sheets.push(
      text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toBeHidden();
  }
  // List: amount, symbol and a fiat line on every row; a delivered KAS leg is a credit.
  for (const cells of all) {
    expect(cells[2], cells.join(" | ")).toMatch(/^\+?[\d,.]+ (KAS|BRD)$/);
    expect(cells[3], cells.join(" | ")).toMatch(/^≈ \$[\d,.]+ USD$/);
  }
  expect(all.map((c) => c[2])).toEqual([
    "+8.662 KAS",
    "+42,595 BRD",
    "1,000 BRD",
  ]);
  // The line after a label is its value.
  const after = (lines: string[], label: string) => {
    const i = lines.indexOf(label);
    expect(i, `${label} in ${lines.join(" | ")}`).toBeGreaterThan(-1);
    return lines.slice(i + 1, i + 3);
  };
  const [sell, buy, unread] = sheets;
  expect(sell[0]).toBe("Swap BRD → KAS");
  expect(after(sell, "Paid")).toEqual(["42,595 BRD", "≈ $0.23 USD"]);
  expect(after(sell, "Received")).toEqual(["8.662 KAS", "≈ $0.23 USD"]);
  expect(after(buy, "Paid")).toEqual(["9.366 KAS", "≈ $0.25 USD"]);
  expect(after(buy, "Received")).toEqual(["42,595 BRD", "≈ $0.23 USD"]);
  for (const [lines, fee, rate] of [
    [sell, "0.113 KAS", "1 BRD ≈ 0.000203 KAS"],
    [buy, "0.091 KAS", "1 KAS ≈ 4,547.952039 BRD"],
  ] as const) {
    expect(after(lines, "Status")[0]).toBe("Completed");
    expect(after(lines, "Network fee")[0]).toBe(fee);
    expect(after(lines, "Kastle fee")[0]).toBe("0 KAS");
    expect(after(lines, "Rate")[0]).toBe(rate);
    expect(after(lines, "Provider")[0]).toBe("Braid");
  }
  // Settle not read: each missing field says so; nothing is blank or a false 0.
  expect(unread[0]).toBe("Swap BRD → KAS");
  expect(after(unread, "Received")).toEqual(["Amount unavailable", "KAS"]);
  expect(after(unread, "Network fee")[0]).toBe("0.018 KAS");
  expect(after(unread, "Kastle fee")[0]).toBe("0 KAS");
  expect(after(unread, "Rate")[0]).toBe("-");
  expect(after(unread, "Provider")[0]).toBe("Braid");
  expect(unread.join(" ")).not.toMatch(/\b0 BRD\b|\+0\b/);
  expect(errors).toEqual([]);
});
