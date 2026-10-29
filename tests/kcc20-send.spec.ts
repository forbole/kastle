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
const amount = (page: Page) => page.locator('input[type="number"]');
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

// As a KRC-20 or .k row: a tap opens the detail page, never send directly.
test("a dashboard tap opens the detail page, not send", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?route=/dashboard`);
  await page.getByRole("button", { name: /NACHO/ }).click();

  await expect(page.getByRole("heading", { name: "NACHO" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "History", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Send to ...")).toBeHidden();
  await page.getByRole("button", { name: "Asset Info", exact: true }).click();
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

test("the picker hides KCC-20 when the kill switch is off", async ({
  page,
}) => {
  await page.goto(`${base}/?route=/asset-select&kcc20=off`);
  await expect(pickerRow(page, /KASPY/)).toBeVisible();
  await expect(pickerRow(page, /NACHO/)).toBeHidden();
});

// The row container's frame and hover tokens; layout tokens may differ.
const frame = async (page: Page, kind: "krc20" | "kcc20") =>
  (
    (await page
      .locator(`[data-row="${kind}"] > *`)
      .getAttribute("class")) ?? ""
  )
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
  await page.goto(`${base}/?route=/dashboard-rows`);
  const row = page.locator('[data-row="kcc20"]');
  // KCC-20 has no price feed: both lines read zero, like an unpriced KRC-20.
  await expect(row.getByText("$0", { exact: true })).toBeVisible();
  await expect(row.getByText("≈ $0.00", { exact: true })).toBeVisible();
  // The subtitle stays.
  await expect(row.getByText("Nacho", { exact: true })).toBeVisible();
});
