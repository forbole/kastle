import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
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
    const p = path.join(outDir, (req.url ?? "/").split("?")[0]);
    const file =
      existsSync(p) && !p.endsWith("/") ? p : path.join(outDir, "index.html");
    res.writeHead(200, {
      "content-type":
        { ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ??
        "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?route=/dashboard${query}`);
  await page.getByRole("button", { name: /NACHO/ }).click();
  await expect(page.getByText("Send to ...")).toBeVisible();
  return errors;
}

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
  await open(page, "&build=error");
  await fill(page, RECIPIENT, "5");
  await next(page).click();
  await expect(
    page.getByText(
      "You don't have enough spendable balance of this token for this amount.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Send to ...")).toBeVisible();
  await expect(next(page)).toBeDisabled();
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
