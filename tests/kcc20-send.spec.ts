import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The KCC-20 send renders the shared token-send screens (details, confirm,
// sending, success / fail) built by tests/kcc20-send/vite.config.mjs, with the
// builder and signer stubbed. The fixture token is 10,000.00 NACHO (2 decimals).

const RECIPIENT = "kaspa:qrecipient1";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-kcc20-send-${process.pid}`);
  await build({
    configFile: path.resolve("tests/kcc20-send/vite.config.mjs"),
    build: { outDir },
  });
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
        { ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ??
        "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?route=/dashboard${query}`);
  await page.getByRole("button", { name: /NACHO/ }).click();
  await sendAction(page).click();
  await expect(page.getByText("Send to ...")).toBeVisible();
  return errors;
}

const sendAction = (page: Page) =>
  page.getByRole("button", { name: "Send NACHO" });

const address = (page: Page) => page.locator("textarea");
const amount = (page: Page) => page.locator('input[inputmode="decimal"]');
const next = (page: Page) => page.getByRole("button", { name: "Next" });
const confirm = (page: Page) => page.getByRole("button", { name: "Confirm" });
const h = (page: Page) => page.evaluate(() => window.__kcc20Send);

async function fill(page: Page, to: string, value: string) {
  await address(page).fill(to);
  await amount(page).fill(value);
  await expect(next(page)).toBeEnabled();
}

test("asset row → details → confirm → success", async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByText("10,000 NACHO")).toBeVisible();

  await fill(page, RECIPIENT, "12.5");
  await next(page).click();

  // Confirm: the shared token confirm with the covenant id as the token row.
  await expect(page.getByText("Sending amount")).toBeVisible();
  await expect(page.getByText(RECIPIENT)).toBeVisible();
  await expect(page.getByText("NACHO", { exact: true })).toBeVisible();
  await expect(page.getByText("12.5", { exact: true })).toBeVisible();
  await expect(page.getByText("0.00012345 KAS")).toBeVisible();
  await expect(page.getByText(/^abababab.*abab$/)).toBeVisible();

  const built = await h(page);
  expect(built.builds).toEqual([
    { recipient: RECIPIENT, amount: "1250", network: "mainnet" },
  ]);

  await confirm(page).click();
  await expect(page.getByText("Sending...")).toBeVisible();
  await expect(page.getByText("NACHO Dispatched")).toBeVisible();
  await expect(
    page.getByText("Your NACHO has been sent to the recipient's address"),
  ).toBeVisible();
  await expect(page.getByText("View in explorer")).toBeVisible();

  const after = await h(page);
  expect(after.recent).toEqual([{ kaspaAddress: RECIPIENT }]);
  expect(errors).toEqual([]);
});

test("a .kas name resolves and confirm shows it", async ({ page }) => {
  await open(page);
  await fill(page, "bob.kas", "1");
  await expect(page.getByText("kaspa:qbob")).toBeVisible();
  await next(page).click();
  await expect(page.getByText("Send to bob.kas")).toBeVisible();
  expect((await h(page)).builds[0].recipient).toBe("kaspa:qbob");
});

test("amount input keeps the token's decimals; Max is exact", async ({
  page,
}) => {
  await open(page);
  await amount(page).fill("1.234");
  await expect(amount(page)).toHaveValue("1.23");

  await page.getByRole("button", { name: "Max" }).click();
  await expect(amount(page)).toHaveValue("10000");
});

test("over-balance, zero and self-send keep Next disabled", async ({
  page,
}) => {
  await open(page);
  await fill(page, RECIPIENT, "1");

  await amount(page).fill("10000.01");
  await expect(page.getByText("Oh, you don’t have enough funds")).toBeVisible();
  await expect(next(page)).toBeDisabled();

  await amount(page).fill("0");
  await expect(next(page)).toBeDisabled();

  await amount(page).fill("1");
  await address(page).fill("kaspa:qowner");
  await expect(
    page.getByText("You cannot send KCC-20 to yourself"),
  ).toBeVisible();
  await expect(next(page)).toBeDisabled();
});

test("a failed build shows the KCC-20 copy and stays on details", async ({
  page,
}) => {
  const copy =
    "You don't have enough spendable balance of this token for this amount.";
  await open(page, "&build=error");
  await fill(page, RECIPIENT, "5");
  await next(page).click();
  await expect(page.getByText(copy)).toBeVisible();
  await expect(page.getByText("Send to ...")).toBeVisible();
  // Not a field error: Next retries without editing, and an edit clears it.
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  expect((await h(page)).builds).toHaveLength(2);
  await amount(page).fill("4");
  await expect(page.getByText(copy)).toBeHidden();
});

test("a recipient build failure sits on the address and clears on edit", async ({
  page,
}) => {
  await open(page, "&build=recipient");
  await fill(page, RECIPIENT, "5");
  await next(page).click();
  await expect(
    page.getByText("Recipient must be a Schnorr address"),
  ).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await address(page).fill("kaspa:qother");
  await expect(
    page.getByText("Recipient must be a Schnorr address"),
  ).toBeHidden();
  await expect(next(page)).toBeEnabled();
});

test("a second build cannot start while one is pending", async ({ page }) => {
  await open(page, "&build=hold");
  await fill(page, RECIPIENT, "5");
  await next(page).click();
  const pending = page.getByRole("status", { name: "loading" });
  await expect(pending).toBeAttached();
  // The spinner button is disabled; a forced click must not start a build.
  const spinning = page.locator("button:has([role=status])");
  await expect(spinning).toBeDisabled();
  await spinning.dispatchEvent("click");
  expect((await h(page)).builds).toHaveLength(1);
  await page.evaluate(() => window.__kcc20Send.release?.());
  await expect(page.getByText("Sending amount")).toBeVisible();
  expect((await h(page)).builds).toHaveLength(1);
});

test("Back is gone while the send is signing", async ({ page }) => {
  await open(page, "&send=hold");
  await fill(page, RECIPIENT, "5");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  const buttons = await page.locator("button").count();
  await confirm(page).click();
  await expect(page.getByRole("status", { name: "loading" })).toBeAttached();
  await expect(page.locator("button")).toHaveCount(buttons - 1);
  await page.evaluate(() => window.__kcc20Send.release?.());
  await expect(page.getByText("NACHO Dispatched")).toBeVisible();
  expect((await h(page)).builds).toHaveLength(1);
});

test("an 18-decimal balance keeps every digit", async ({ page }) => {
  await open(page, "&token=1");
  await expect(page.getByText("0.000000000000000001 NACHO")).toBeVisible();
  await page.goto("about:blank");
  await open(page, "&token=123456789012345678901234567890");
  await expect(
    page.getByText("123,456,789,012.34567890123456789 NACHO"),
  ).toBeVisible();
});

test("a failed send lands on the shared fail screen with the reason", async ({
  page,
}) => {
  await open(page, "&send=error");
  await fill(page, RECIPIENT, "5");
  await next(page).click();
  await confirm(page).click();
  await expect(page.getByText("Sorry, Your Majesty.")).toBeVisible();
  await expect(page.getByText("node rejected the transaction")).toBeVisible();
  expect((await h(page)).recent).toEqual([]);
});

test("Back from confirm keeps the form and Next rebuilds", async ({ page }) => {
  await open(page);
  await fill(page, RECIPIENT, "3");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();

  await page.locator("button").first().click();
  await expect(address(page)).toHaveValue(RECIPIENT);
  await expect(amount(page)).toHaveValue("3");

  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  expect((await h(page)).builds).toHaveLength(2);
});

test("an unknown covenant id shows the unavailable state", async ({ page }) => {
  await page.goto(`${base}/?route=/kcc20/send/${"cd".repeat(32)}`);
  await expect(page.getByText("This token cannot be sent.")).toBeVisible();
});

// Review: a rejected lookup never yields data; it must not spin on
// "Loading token..." forever but land on the unavailable copy.
test("a rejected token lookup shows the unavailable state, not loading", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/kcc20/send/${"ab".repeat(32)}&kcc20Error=1`);
  await expect(page.getByText("This token cannot be sent.")).toBeVisible();
  await expect(page.getByText("Loading token...")).toHaveCount(0);
});

// QA 4: an unsettled lookup (no data yet, isLoading already false) is not a
// verdict. Records when the unavailable copy first paints, if ever.
async function watchCannotSend(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cannotSendAt?: number };
    new MutationObserver(() => {
      if (
        w.__cannotSendAt === undefined &&
        document.body?.textContent?.includes("This token cannot be sent.")
      ) {
        w.__cannotSendAt = performance.now();
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}
const marks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __cannotSendAt?: number;
      __kcc20SettledAt?: number;
    };
    return { cannotSendAt: w.__cannotSendAt, settledAt: w.__kcc20SettledAt };
  });

test("an unsettled token lookup shows loading, then the form", async ({
  page,
}) => {
  await watchCannotSend(page);
  await page.goto(
    `${base}/?route=/kcc20/send/${"ab".repeat(32)}&kcc20Unsettled=400`,
  );
  await expect(page.getByText("Loading token...")).toBeVisible();
  await expect(page.getByText("Send to ...")).toBeVisible();
  const { cannotSendAt, settledAt } = await marks(page);
  expect(settledAt).toBeDefined();
  expect(cannotSendAt).toBeUndefined();
});

test("the unavailable copy waits for the lookup to settle", async ({
  page,
}) => {
  await watchCannotSend(page);
  await page.goto(
    `${base}/?route=/kcc20/send/${"cd".repeat(32)}&kcc20Unsettled=400`,
  );
  await expect(page.getByText("This token cannot be sent.")).toBeVisible();
  const { cannotSendAt, settledAt } = await marks(page);
  expect(settledAt).toBeDefined();
  expect(cannotSendAt! >= settledAt!).toBe(true);
});

// As a KRC-20 or .k row: a tap opens the detail page, never send directly.
test("a dashboard tap opens the detail page, not send", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?route=/dashboard`);
  await page.getByRole("button", { name: /NACHO/ }).click();

  await expect(page.getByRole("heading", { name: "NACHO" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "History", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Send to ...")).toBeHidden();
  await page.getByRole("tab", { name: "Token info", exact: true }).click();
  await expect(page.getByText("Covenant ID")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: /NACHO/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the detail page hides Send without a spendable piece", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/kcc20/${"ab".repeat(32)}&unsendable=1`);
  await expect(page.getByRole("heading", { name: "NACHO" })).toBeVisible();
  await expect(sendAction(page)).toHaveCount(0);
});

// The KRC-20 send renders through the same shared details / confirm screens.
test("KRC-20 send still goes details → confirm", async ({ page }) => {
  await page.goto(`${base}/?route=/krc20/send/KASPY`);
  await expect(page.getByText("1,000 KASPY")).toBeVisible();
  await expect(page.getByText("Estimated")).toBeVisible();
  await fill(page, RECIPIENT, "2");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  await expect(page.getByText("2", { exact: true })).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
});

// Copilot #437: Max past 2^53 used to fail a float compare against the balance.
test("KRC-20 Max of a balance past 2^53 is exact and keeps Next enabled", async ({
  page,
}) => {
  await page.goto(
    `${base}/?route=/krc20/send/KASPY&krc20balance=9007199254740993`,
  );
  await expect(page.getByText("Estimated")).toBeVisible();
  await fill(page, RECIPIENT, "1");
  await page.getByRole("button", { name: "Max" }).click();
  await expect(amount(page)).toHaveValue("90071992.54740993");
  await expect(page.getByText("Oh, you don’t have enough funds")).toBeHidden();
  await expect(next(page)).toBeEnabled();
});

// Copilot #437: a trailing or leading space used to skip the clamp.
test("KRC-20 amount trims whitespace before clamping", async ({ page }) => {
  await page.goto(`${base}/?route=/krc20/send/KASPY`);
  await expect(page.getByText("Estimated")).toBeVisible();
  await fill(page, RECIPIENT, "1");
  for (const typed of ["0.000000001 ", " 0.000000001"]) {
    await amount(page).fill(typed);
    await expect(amount(page)).toHaveValue("0.00000000");
  }
});

// The Send button's asset picker (/asset-select) lists KCC-20 beside KRC-20.
const pickerRow = (page: Page, name: RegExp) =>
  page.getByRole("button", { name });

test("the picker lists a KCC-20 row like a KRC-20 row and opens its send", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?route=/asset-select`);

  const krc20 = pickerRow(page, /KASPY/);
  const kcc20 = pickerRow(page, /NACHO/);
  await expect(krc20).toContainText("1,000");
  await expect(kcc20).toContainText("10,000");
  await expect(kcc20).toContainText("abababab...babab");
  // Same row markup: only the data differs.
  expect(await kcc20.getAttribute("class")).toBe(
    await krc20.getAttribute("class"),
  );
  expect(await kcc20.getByAltText("Chain").getAttribute("src")).toBe(
    await krc20.getByAltText("Chain").getAttribute("src"),
  );

  await kcc20.click();
  await expect(page.getByText("Send to ...")).toBeVisible();
  await expect(page.getByText("10,000 NACHO")).toBeVisible();
  await fill(page, RECIPIENT, "1");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  expect((await h(page)).builds).toEqual([
    { recipient: RECIPIENT, amount: "100", network: "mainnet" },
  ]);
  expect(errors).toEqual([]);
});

test("the picker search matches the KCC-20 symbol", async ({ page }) => {
  await page.goto(`${base}/?route=/asset-select`);
  const search = page.getByPlaceholder("Search token");

  await search.fill("nac");
  await expect(pickerRow(page, /NACHO/)).toBeVisible();
  await expect(pickerRow(page, /KASPY/)).toBeHidden();

  await search.fill("zzz");
  await expect(pickerRow(page, /NACHO/)).toBeHidden();
  await expect(page.getByText("No result found")).toBeVisible();
});

test("the picker shows no empty state while KCC-20 is loading", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/asset-select&kcc20Loading=1`);
  const search = page.getByPlaceholder("Search token");
  await search.fill("zzz");
  await expect(pickerRow(page, /KASPY/)).toBeHidden();
  await expect(page.getByText("No result found")).toBeHidden();
});

// unverified only means issuer-claimed, never attested: no registry rejected the
// row, so the picker must not claim a failed verification (QA issue 3).
test("the picker shows no Unverified chip on an issuer-claimed KCC-20 row", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/asset-select&unverified=1`);
  await expect(pickerRow(page, /NACHO/)).toBeVisible();
  await expect(pickerRow(page, /NACHO/)).not.toContainText("Unverified");
  await page.goto(`${base}/?route=/asset-select`);
  await expect(pickerRow(page, /NACHO/)).toBeVisible();
  await expect(pickerRow(page, /NACHO/)).not.toContainText("Unverified");
});

test("the picker hides KCC-20 when the kill switch is off", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/asset-select&kcc20=off`);
  await expect(pickerRow(page, /KASPY/)).toBeVisible();
  await expect(pickerRow(page, /NACHO/)).toBeHidden();
});

// The row container's frame and hover tokens; layout tokens may differ.
const frame = async (page: Page, kind: "krc20" | "kcc20") =>
  ((await page.locator(`[data-row="${kind}"] > *`).getAttribute("class")) ?? "")
    .split(/\s+/)
    .filter((c) => /^(hover:|border|rounded|bg-|p[xy]?-)/.test(c))
    .sort();

test("a KCC-20 dashboard row glows on hover like a KRC-20 row", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/dashboard-rows`);
  const krc20 = await frame(page, "krc20");
  expect(krc20).toContain("hover:border-white");
  expect(await frame(page, "kcc20")).toEqual(krc20);
});

test("a KCC-20 dashboard row shows a price and a fiat line", async ({
  page,
}) => {
  // 10,000 NACHO at $0.25.
  await page.goto(`${base}/?route=/dashboard-rows&price=0.25`);
  const row = page.locator('[data-row="kcc20"]');
  await expect(row.getByText("$0.25", { exact: true })).toBeVisible();
  await expect(row.getByText("≈ $2,500.00", { exact: true })).toBeVisible();
  // As mobile: no name line on a list row.
  await expect(row.getByText("Nacho", { exact: true })).toHaveCount(0);
});

test("an unpriced KCC-20 dashboard row prints no fiat, not a placeholder nor zero", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/dashboard-rows`);
  const row = page.locator('[data-row="kcc20"]');
  await expect(row.getByText("10,000", { exact: true })).toBeVisible();
  await expect(row.getByText(/—|≈|\$/)).toHaveCount(0);
  // Hidden balances mask a value, never invent one.
  await page.goto(`${base}/?route=/dashboard-rows&hidden=1`);
  await expect(row.getByText("*****", { exact: true })).toBeVisible();
  await expect(row.getByText(/—|≈|\$/)).toHaveCount(0);
});

test("a KCC-20 dashboard row masks its fiat value with balances hidden", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/dashboard-rows&price=0.25&hidden=1`);
  const row = page.locator('[data-row="kcc20"]');
  await expect(row.getByText("*****", { exact: true })).toBeVisible();
  await expect(row.getByText("10,000", { exact: true })).toHaveCount(0);
  await expect(row.getByText("≈ $*****", { exact: true })).toBeVisible();
  await expect(row.getByText("≈ $2,500.00", { exact: true })).toHaveCount(0);
  // The unit price is public, not a balance.
  await expect(row.getByText("$0.25", { exact: true })).toBeVisible();
});

// A scanned standard row reads like mobile: ticker, whole tokens, no family chip,
// one quiet status marker; its history never prints a field kascov did not answer.
test("a standard KCC-20 row and its history read like mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // 210759267306 base units at 8 decimals, metadata claimed by kascov.
  await page.goto(
    `${base}/?route=/dashboard&token=210759267306&decimals=8&unverified=1&history=1`,
  );
  const row = page.getByRole("button", { name: /NACHO/ });
  await expect(row.getByText("2,107.593", { exact: true })).toBeVisible();
  await expect(row.getByText("210759267306")).toHaveCount(0);
  await expect(row.getByText(/^(KCC-20|KRON)$/)).toHaveCount(0);
  await expect(row.getByText(/base units/)).toHaveCount(0);
  // The list row carries no status marker; the detail page does.
  await expect(row.getByText("Unverified", { exact: true })).toHaveCount(0);

  await row.click();
  await expect(page.getByRole("heading", { name: "NACHO" })).toBeVisible();
  // The designed row: "Received from <sender>", the date, the amount with
  // its symbol; no txid on the row.
  const received = page.getByRole("button", { name: /^Received/ });
  await expect(received).toContainText(/｜\d{2}:\d{2}/);
  await expect(
    received.getByText("+2,107.593 NACHO", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Received from qsen…0000")).toBeVisible();
  await expect(page.getByText("Unattributed movement")).toBeVisible();
  await expect(page.getByText(/kcc20amb|kcc20rx/)).toHaveCount(0);

  // The unattributed record has no amount and no counterparty, so neither
  // row is drawn; its status is unknown, so the designed sheet says
  // "Unconfirmed".
  await page.getByText("Unattributed movement").click();
  const sheet = page.getByRole("heading", { name: "TX Hash" });
  await expect(sheet).toBeVisible();
  await expect(page.getByText("kcc20amb", { exact: true })).toBeVisible();
  await expect(page.getByText(/Unavailable|Unknown/)).toHaveCount(0);
  for (const label of ["Amount", "From", "To"])
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Status", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Unconfirmed", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a nameless standard KCC-20 row shows grouped base units", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/dashboard&token=210759267306&nometa=1`);
  const row = page.locator("button").first();
  // Beside the long monospace id the full figure would truncate the title:
  // it compacts, and the grouped base units stay as its tooltip.
  await expect(row.getByTitle("210,759,267,306 base units")).toHaveText(
    "210.76B base units",
  );
  // The short id is the fallback title, in monospace; no marker on the list row.
  await expect(row.locator(".font-mono")).toHaveText("abababab...babab");
  await expect(row.getByText(/Unverified/)).toHaveCount(0);
});

// One component, both families: the same parts in the same places. The
// fixture is the defect: 200,759,267,306 base units, no decimals, no market.
test("a KRON row and a standard row share one shape, and a 12-digit base-unit balance does not wrap", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `${base}/?route=/dashboard-families&token=200759267306&nodecimals=1&unverified=1&kronPrice=0.00000232`,
  );
  const kron = page.locator('[data-row="kron"]');
  const std = page.locator('[data-row="standard"]');

  // KRON: ticker, unit price, balance, fiat.
  await expect(kron.getByText("WHALE", { exact: true })).toBeVisible();
  await expect(kron.getByText("$0.00000232", { exact: true })).toBeVisible();
  await expect(kron.getByText("128,001", { exact: true })).toBeVisible();
  // Sub-dollar holding value keeps up to 8 decimals (formatUsdAmount).
  await expect(kron.getByText("≈ $0.29696232", { exact: true })).toBeVisible();
  // Standard, unknown scale and no market: ticker and grouped base units only.
  // At the popup's width the full figure would truncate NACHO, so it compacts
  // and keeps the exact value as its tooltip.
  const balance = std.getByText("200.76B base units", { exact: true });
  await expect(balance).toHaveAttribute("title", "200,759,267,306 base units");
  await expect(std.getByText("NACHO", { exact: true })).toBeVisible();
  await expect(balance).toBeVisible();
  await expect(std.getByText(/—|≈|\$/)).toHaveCount(0);

  for (const row of [kron, std]) {
    // No name line, no family label, no status marker.
    await expect(row.getByText(/^(Nacho|Whale)$/)).toHaveCount(0);
    await expect(row.getByText(FAMILY)).toHaveCount(0);
    await expect(row.getByText(/Unverified/)).toHaveCount(0);
  }

  const box = async (l: ReturnType<Page["locator"]>) =>
    (await l.boundingBox())!;
  const tickers = [kron.getByText("WHALE"), std.getByText("NACHO")];
  const balances = [kron.getByText("128,001"), balance];
  const frames = [kron.getByRole("button"), std.getByRole("button")];
  for (const i of [0, 1]) {
    const [t, b, f] = [
      await box(tickers[i]),
      await box(balances[i]),
      await box(frames[i]),
    ];
    // Balance right-aligned to the row's inner edge (p-3 + 1px border = 13).
    expect(Math.abs(f.x + f.width - 13 - (b.x + b.width))).toBeLessThan(1.5);
    // Ticker and balance share the top line.
    expect(Math.abs(t.y - b.y)).toBeLessThan(2);
    // The ticker reads in full: never truncated, never pushed off its start.
    expect(
      await tickers[i].evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    expect(
      await balances[i].evaluate((e) => getComputedStyle(e).fontVariantNumeric),
    ).toContain("tabular-nums");
  }
  // Same column for both tickers, whatever the balance's length.
  expect((await box(tickers[0])).x).toBeCloseTo((await box(tickers[1])).x, 0);
  // The 12-digit balance stays one line.
  const lineHeight = await balance.evaluate((e) =>
    parseFloat(getComputedStyle(e).lineHeight),
  );
  expect((await box(balance)).height).toBeLessThan(lineHeight * 1.5);

  // No artwork: the existing Kaspa placeholder, not a gap.
  const logo = std.locator('img[alt="Token"]');
  await expect(logo).toBeVisible();
  expect(
    await logo.evaluate((e: HTMLImageElement) => e.naturalWidth),
  ).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Partial kascov claims: whichever half arrived is used, the other half falls
// back. No family is named, on the row or in the send picker.
const FAMILY = /KRON|KCC-?20/;

test("a standard KCC-20 row with decimals and no ticker formats its amount under a short id", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const claim = "token=210759267306&decimals=8&notick=1&unverified=1";
  await page.goto(`${base}/?route=/dashboard&${claim}`);
  const row = page.locator("button", { hasText: "abababab...babab" });
  await expect(row.getByText("2,107.593", { exact: true })).toBeVisible();
  await expect(row.getByText(/base units/)).toHaveCount(0);
  await expect(row.locator(".font-mono")).toHaveText("abababab...babab");
  await expect(row.getByText(FAMILY)).toHaveCount(0);

  // Decimals known: sendable, listed in the picker under the same short id.
  await page.goto(`${base}/?route=/asset-select&${claim}`);
  const pick = page.locator("button", { hasText: "abababab...babab" });
  await expect(pick.locator(".font-mono")).toHaveText("abababab...babab");
  await expect(pick).toContainText("2,107.59");
  await pick.locator("img").first().hover();
  await expect(page.getByText(FAMILY)).toHaveCount(0);

  // Its send labels the asset and the confirm Ticker with that short id, never blank.
  await pick.click();
  await expect(page.getByText("Send to ...")).toBeVisible();
  await fill(page, RECIPIENT, "1");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  // The Ticker row and the token id row both read the short id.
  await expect(page.getByText("abababab...babab", { exact: true })).toHaveCount(
    2,
  );
  expect(errors).toEqual([]);
});

test("a standard KCC-20 row with a ticker and no decimals shows grouped base units", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const claim = "token=210759267306&nodecimals=1&unverified=1";
  await page.goto(`${base}/?route=/dashboard&${claim}`);
  const row = page.getByRole("button", { name: /NACHO/ });
  await expect(row.getByText("NACHO", { exact: true })).toBeVisible();
  await expect(
    row.getByText("210,759,267,306 base units", { exact: true }),
  ).toBeVisible();
  await expect(row.locator(".font-mono")).toHaveCount(0);
  await expect(row.getByText(FAMILY)).toHaveCount(0);

  // No scale, no typed amount means anything: kept out of the send picker.
  await page.goto(`${base}/?route=/asset-select&${claim}`);
  await expect(page.getByRole("button", { name: /KASPY/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /NACHO/ })).toHaveCount(0);
  await expect(page.getByText(FAMILY)).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Mirrors KRC20_FILL_LOGO in tests/kcc20-send/stubs.ts (krc20logo=1).
const KRC20_FILL_LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%23ff9900'/%3E%3C/svg%3E";

// The chip on one address row of the confirm step.
const chip = (page: Page, row: "Send from" | "Send to") =>
  page
    .locator("div.rounded-lg")
    .filter({ hasText: row })
    .locator("span.rounded-full");

// UAT2 #12: the asset button shows the token's own (KRC-20-filled) artwork.
test("KCC-20 send shows the token's filled logo, not the Kaspa mark", async ({
  page,
}) => {
  const errors = await open(page, "&krc20logo=1");
  const logo = page.locator('img[alt="Token"]').first();
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.getAttribute("src")).toBe(KRC20_FILL_LOGO);
  // Without a fill the row has no artwork and the Kaspa mark stands in.
  await open(page);
  const plain = page.locator('img[alt="Token"]').first();
  await expect.poll(() => plain.getAttribute("src")).not.toBe(KRC20_FILL_LOGO);
  expect(errors).toEqual([]);
});

// UAT2 #14: Max at a market price fills a non-zero fiat value, and confirm
// prices the sent amount.
test("KCC-20 Max shows a non-zero USD value on details and confirm", async ({
  page,
}) => {
  const errors = await open(page, "&price=0.25");
  await address(page).fill(RECIPIENT);
  await page.getByRole("button", { name: "Max" }).click();
  await expect(amount(page)).toHaveValue("10000");
  const fiat = page.locator('input[name="amountFiat"]');
  await expect
    .poll(async () => Number((await fiat.inputValue()).replace(/,/g, "")))
    .toBe(2500);

  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  await expect(page.getByText("$2,500.00", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

// A typed fiat value derives the amount at the token's scale: 8 places on a
// 6-decimal token fails decimalsError and Next stays disabled.
test("a fiat value on a priced 6-decimal KCC-20 fills a sendable amount", async ({
  page,
}) => {
  // 1,000,000 base units at 6 decimals = 1 NACHO, priced at $0.30.
  const errors = await open(page, "&decimals=6&price=0.3");
  await address(page).fill(RECIPIENT);
  await page.locator('input[name="amountFiat"]').fill("0.1");
  await expect(amount(page)).toHaveValue("0.333333");
  await expect(page.getByText(/at most \d+ decimal places/)).toHaveCount(0);
  await expect(next(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

// The fiat → token conversion is integer math: $0.10 at $1 on an 18-decimal
// token is exactly 0.1, not 0.100000000000000006, so a wallet holding exactly
// 0.1 can send it.
test("a fiat value spending an exact 18-decimal balance keeps Next enabled", async ({
  page,
}) => {
  // 10^17 base units at 18 decimals = exactly 0.1 NACHO, priced at $1.00.
  const errors = await open(page, "&token=100000000000000000&price=1");
  await address(page).fill(RECIPIENT);
  await page.locator('input[name="amountFiat"]').fill("0.10");
  await expect(amount(page)).toHaveValue("0.1");
  await expect(page.getByText("Oh, you don’t have enough funds")).toHaveCount(
    0,
  );
  await expect(next(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test("an unpriced KCC-20 still sends with a zero USD value", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Max" }).click();
  await expect(amount(page)).toHaveValue("10000");
  const fiat = page.locator('input[name="amountFiat"]');
  await expect.poll(() => fiat.inputValue()).toBe("0");
});

// UAT2 #16: both address rows carry the token standard on a KCC-20 confirm.
test("KCC-20 confirm shows KCC20 on both address rows", async ({ page }) => {
  await open(page);
  await fill(page, RECIPIENT, "12.5");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  for (const row of ["Send from", "Send to"] as const) {
    await expect(chip(page, row)).toHaveCount(1);
    await expect(chip(page, row)).toHaveText("KCC20");
  }
  await expect(page.getByText("Kaspa", { exact: true })).toHaveCount(0);
});

test("KRC-20 confirm still shows Kaspa on both address rows", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/krc20/send/KASPY`);
  await fill(page, RECIPIENT, "2");
  await next(page).click();
  await expect(page.getByText("Sending amount")).toBeVisible();
  for (const row of ["Send from", "Send to"] as const) {
    await expect(chip(page, row)).toHaveCount(1);
    await expect(chip(page, row)).toHaveText("Kaspa");
  }
  await expect(page.getByText("KCC20", { exact: true })).toHaveCount(0);
});
