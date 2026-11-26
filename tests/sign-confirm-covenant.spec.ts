import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real dApp sign confirm screen, built by tests/sign-confirm-covenant/
// with the real WASM and decode; only the wallet, settings and the KCC-20
// pieces fetch are stubbed. The v1 tx is the kaspa.com repro.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-sign-confirm-${process.pid}`);
  // vite.build sets NODE_ENV=production in the worker; restore it for the
  // React specs that run after in the same worker.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/sign-confirm-covenant/vite.config.mjs"),
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
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".wasm": "application/wasm",
        }[path.extname(file)] ?? "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?${query}`);
  await expect(page.getByText("Change to your balance")).toBeVisible();
  return errors;
}

const confirm = (page: Page) => page.getByRole("button", { name: "Confirm" });
const h = (page: Page) => page.evaluate(() => window.__signHarness);
const SITE_STATED =
  "As stated by the site: an input this wallet doesn't sign carries the site's own amount";
const CAVEAT =
  "Kastle verifies the pieces leaving your wallet. It cannot show the token amounts inside the destination covenant.";

test("v1 spending a wallet piece lists it, with the caveat, and confirms", async ({
  page,
}) => {
  const errors = await open(page, "tx=v1&pieces=a");
  await expect(
    page.getByText("KCC-20 tokens leaving your wallet"),
  ).toBeVisible();
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await expect(page.getByText("-1.25", { exact: true })).toBeVisible();
  // Outputs 0 and 1 are bound to input 0; output 1 is input 0's own P2SH.
  await expect(
    page.getByText(/^To kaspates\.\.\.\w{5}, kaspates/),
  ).toBeVisible();
  await expect(page.getByText(CAVEAT)).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
  expect(await confirm(page).getAttribute("class")).toBe(
    "flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600",
  );
  await confirm(page).click();
  const harness = await h(page);
  expect(harness.confirmed).toBe(1);
  // The harness stubs the standard-family flag off; the guard scans anyway.
  expect(harness.pieceCalls).toEqual([
    [{ network: "testnet-10", standard: true }],
  ]);
  expect(errors).toEqual([]);
});

const MAINNET_NONE =
  "Kastle does not see any KCC-20 token of yours in this request.";
const OFF_MAINNET_NONE =
  "No KCC-20 tokens that Kastle can check on this network move in this request. Standard KCC-20 tokens cannot be checked here.";
const OFF_MAINNET_CAVEAT =
  "Standard KCC-20 tokens cannot be checked on this network.";

test("v1 spending no piece on mainnet says Kastle sees none of yours, without the off-mainnet caveat", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=none&network=mainnet");
  await expect(page.getByText(MAINNET_NONE, { exact: true })).toBeVisible();
  await expect(page.getByText(OFF_MAINNET_NONE)).toHaveCount(0);
  await expect(page.getByText(CAVEAT, { exact: true })).toBeVisible();
  await expect(page.getByText(OFF_MAINNET_CAVEAT)).toHaveCount(0);
  await expect(confirm(page)).toBeEnabled();
});

test("v1 spending no piece on testnet-10 says only checkable tokens, with the extra caveat", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=none&network=testnet-10");
  await expect(page.getByText(OFF_MAINNET_NONE, { exact: true })).toBeVisible();
  await expect(page.getByText(MAINNET_NONE)).toHaveCount(0);
  await expect(
    page.getByText(`${CAVEAT} ${OFF_MAINNET_CAVEAT}`, { exact: true }),
  ).toBeVisible();
});

test("an authorized output with no address shows as an unknown destination", async ({
  page,
}) => {
  await open(page, "tx=v1unknown&pieces=a");
  await expect(
    page.getByText(/^To Unknown destination \(output 0\), kaspates/),
  ).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
});

test("v1 spending no piece says so in one line and confirms", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=none");
  await expect(page.getByText(OFF_MAINNET_NONE)).toBeVisible();
  await expect(page.getByText("KCC-20 tokens leaving your wallet")).toHaveCount(
    0,
  );
  await expect(confirm(page)).toBeEnabled();
});

test("two tokens: two rows, unknown ticker shows the short id and base units", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=ab");
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2c4c9e0f...0dd36", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("-42 base units", { exact: true })).toBeVisible();
});

test("while the decode runs, confirm stays disabled", async ({ page }) => {
  await open(page, "tx=v1&pieces=hang");
  await expect(
    page.getByRole("status").filter({ hasText: "Checking" }),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  await confirm(page).click({ force: true });
  expect((await h(page)).confirmed).toBe(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

test("a failed fetch shows the failure and keeps confirm disabled", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=throw");
  await expect(page.getByRole("alert")).toContainText(
    "could not check which KCC-20 tokens",
  );
  await expect(confirm(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

test("v1 keeps the caller's warning and appends the caveat", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=none&warning=Partial%20outputs");
  await expect(page.getByText(`Partial outputs\n\n${CAVEAT}`)).toBeVisible();
});

test("Ledger: covenant confirm is blocked with one line, Cancel still works", async ({
  page,
}) => {
  const errors = await open(page, "tx=v1&pieces=a&wallet=ledger");
  await expect(
    page.getByText("Covenant transactions cannot be signed on Ledger."),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  // L1: the blocked classes are space-separated from the base list.
  expect(await confirm(page).getAttribute("class")).toBe(
    "flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600 cursor-not-allowed opacity-50 hover:bg-icy-blue-400",
  );
  await confirm(page).click({ force: true });
  expect((await h(page)).confirmed).toBe(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await h(page)).cancelled).toBe(1);
  expect(errors).toEqual([]);
});

const PARTIAL_SIGHASH =
  "This request signs with a partial sighash, so the KCC-20 movement shown above could change after you approve.";

for (const sign of ["AllAnyOneCanPay", "SingleAnyOneCanPay"]) {
  test(`v1 signed with ${sign} blocks confirm with one line`, async ({
    page,
  }) => {
    const errors = await open(page, `tx=v1&pieces=a&sign=${sign}`);
    await expect(
      page.getByText(PARTIAL_SIGHASH, { exact: true }),
    ).toBeVisible();
    await expect(confirm(page)).toBeDisabled();
    await confirm(page).click({ force: true });
    expect((await h(page)).confirmed).toBe(0);
    await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

test("v1 signed with All confirms", async ({ page }) => {
  await open(page, "tx=v1&pieces=a&sign=All");
  await expect(page.getByText("AAA", { exact: true })).toBeVisible();
  await expect(page.getByText(PARTIAL_SIGHASH)).toHaveCount(0);
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  expect((await h(page)).confirmed).toBe(1);
});

test("v0 renders no token section, no caveat and never fetches", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0&pieces=throw");
  await expect(page.getByText(/KCC-20/)).toHaveCount(0);
  await expect(page.getByText(CAVEAT)).toHaveCount(0);
  await expect(confirm(page)).toBeEnabled();
  expect((await h(page)).pieceCalls).toEqual([]);
  expect(errors).toEqual([]);
});

// The row's value column, by its label: assert the rendered text, not a prop.
const row = (page: Page, label: string) =>
  page
    .locator("li")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator(".text-right");

test("a 2,000-sompi fee renders exactly, not 0.000 KAS", async ({ page }) => {
  const errors = await open(page, "tx=fee2000");
  await expect(row(page, "Fee").locator("span").first()).toHaveText(
    "0.00002 KAS",
  );
  await expect(row(page, "Sending amount").locator("span").first()).toHaveText(
    "0 KAS",
  );
  await expect(
    row(page, "Change to your balance").locator("span").first(),
  ).toHaveText("-0.00002 KAS");
  await expect(page.getByText(/0\.000 KAS/)).toHaveCount(0);
  // The wallet signs its one input: no site-stated label.
  await expect(row(page, "Fee")).not.toContainText(SITE_STATED);
  expect(errors).toEqual([]);
});

test("v1 fee, sending amount and balance change are exact sompi", async ({
  page,
}) => {
  await open(page, "tx=v1&pieces=a");
  // inputs 2,407,397,297,988 - outputs 2,407,377,288,988 = 20,009,000 sompi
  await expect(row(page, "Fee").locator("span").first()).toHaveText(
    "0.20009 KAS",
  );
  await expect(row(page, "Sending amount").locator("span").first()).toHaveText(
    "1 KAS",
  );
  await expect(
    row(page, "Change to your balance").locator("span").first(),
  ).toHaveText("-0.20009 KAS");
  // Exactly once: outputs 0-2 leave the wallet's script, 2 KAS in all.
  // Piece A's 1 KAS (out of outputs 0 and 1) is its gross-input row, never a
  // movement; Sending shows the rest.
  await expect(
    page.getByText(
      "Gross input KAS in the AAA pieces, incl. any change and fee",
    ),
  ).toBeVisible();
  await expect(page.getByText("-1 KAS", { exact: true })).toHaveCount(0);
  // Input 1 is neither scripted nor the wallet's: its amount is the page's word.
  await expect(row(page, "Fee")).toContainText(SITE_STATED);
});

test("an input with no UTXO amount makes the fee not known, never 0", async ({
  page,
}, testInfo) => {
  // Defensive: the real deserializer rejects an entry-less input, so the product
  // cannot reach this state; the harness builds it (stubs.ts ?tx=v1nofee) to pin the branch.
  const errors = await open(page, "tx=v1nofee&pieces=a");
  const why = "Kastle does not have the amount of input 1";
  await expect(row(page, "Fee")).toHaveText(`Not known${why}`);
  await expect(row(page, "Change to your balance")).toHaveText(
    `Not known${why}`,
  );
  await expect(row(page, "Fee")).not.toContainText("0");
  await page.screenshot({
    path: testInfo.outputPath("sign-window-fee-not-known.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("each token shows the KAS its pieces carry as its own row, and says the amount is gross", async ({
  page,
}, testInfo) => {
  const errors = await open(page, "tx=v1&pieces=ab");
  const kasRows = page
    .locator("li")
    .filter({ has: page.getByText("KAS", { exact: true }) });
  await expect(kasRows).toHaveCount(2);
  // Gross input KAS, never printed as a movement (no minus sign).
  await expect(kasRows.nth(0)).toContainText(
    "Gross input KAS in the AAA pieces, incl. any change and fee",
  );
  await expect(kasRows.nth(0)).not.toContainText("Moves with");
  await expect(kasRows.nth(0)).not.toContainText("-1 KAS");
  await expect(kasRows.nth(0)).toContainText("1 KAS");
  await expect(kasRows.nth(1)).not.toContainText("-1 KAS");
  // the token row itself stays the token amount alone
  await expect(page.getByText("-1.25", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Each token amount is the whole piece leaving your wallet. How much of it comes back to you as change cannot be computed from this request.",
      { exact: true },
    ),
  ).toBeVisible();
  // the carried KAS is not folded into the fee
  await expect(row(page, "Fee").locator("span").first()).toHaveText(
    "0.20009 KAS",
  );
  await page.screenshot({
    path: testInfo.outputPath("sign-window-covenant.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

// signPskt (psktRequest): v0mixed input 0 is a foreign covenant P2SH, input 1
// the wallet's own coin, signed by the fallback.
const ANYONE_CAN_PAY =
  "An input signed with AllAnyOneCanPay lets another party add inputs to this transaction after you approve. The outputs stay as shown.";
const SHOTS = path.resolve("test-results/sign-pskt-confirm");

// The popup is fixed-width: at 320px nothing may scroll sideways.
async function at320(page: Page) {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.getElementById("popup")!.style.width = "320px";
  });
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("#popup *")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .filter((el) => getComputedStyle(el).overflowX !== "visible")
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(overflow).toEqual([]);
  expect(
    await page.evaluate(
      () => document.getElementById("popup")!.getBoundingClientRect().right,
    ),
  ).toBeLessThanOrEqual(320);
  for (const name of ["Cancel", "Confirm"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

test("signPskt, mixed: N inputs, M not your own coin, each sighash in words", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0mixed&pskt=0:All");
  await expect(page.getByText("Sign only", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "The site built this transaction, not your wallet's send screen",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("2 inputs, 1 not your own coin", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Signed with your key without being held at your address"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Inputs not listed below are your own coins, signed with All",
    ),
  ).toBeVisible();
  await expect(page.getByText("Input 0", { exact: true })).toBeVisible();
  await expect(page.getByText("All", { exact: true })).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
  await at320(page);
  await page.screenshot({ path: `${SHOTS}/mixed-320.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("signPskt with All: the sighash row says All, and no AnyOneCanPay warning", async ({
  page,
}) => {
  await open(page, "tx=v0mixed&pskt=0:All");
  await expect(
    page.getByText("2 inputs, 1 not your own coin", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("All", { exact: true })).toBeVisible();
  await expect(page.getByText(ANYONE_CAN_PAY)).toHaveCount(0);
});

test("signPskt without UTXO entries: the count is labelled not known, never 0", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0mixednofee&pskt=0:All");
  const row = page.locator("li").filter({ hasText: "Inputs you sign" });
  await expect(row).toContainText("Not known");
  await expect(row).toContainText(
    "The site did not send the coin details of every input, so Kastle cannot count them",
  );
  await expect(row).not.toContainText("0 not your own coin");
  await expect(row).not.toContainText(/\d+ inputs?,/);
  await at320(page);
  await page.screenshot({ path: `${SHOTS}/no-utxo-320.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("signPskt while the account loads: the count row is neutral, never blames the site", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0mixed&pskt=0:All&account=loading");
  const row = page.locator("li").filter({ hasText: "Inputs you sign" });
  await expect(row).toContainText("Counting the inputs this request signs…");
  await expect(row).not.toContainText("did not send");
  await expect(row).not.toContainText("Not known");
  expect(errors).toEqual([]);
});

// signPskt cannot carry AllAnyOneCanPay (psktSignOptions signs All); a signTx
// script option still can. v0's input 0 is the wallet's own coin.
test("a signTx request with an AllAnyOneCanPay script option shows the AnyOneCanPay warning", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0&sign=AllAnyOneCanPay&signIndex=0");
  await expect(page.getByText(ANYONE_CAN_PAY)).toBeVisible();
  await expect(page.getByText("Inputs you sign")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// v0presigned: listed P2SH 0, own coin 1 arrives signed, own coin 2 empty.
test("signPskt: an own coin that arrives signed is not counted as signed", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0presigned&pskt=0:All");
  await expect(
    page.getByText("2 inputs, 1 not your own coin", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("signPskt: an own coin that arrives signed has no per-input row", async ({
  page,
}) => {
  await open(page, "tx=v0presigned&pskt=0:All");
  await expect(page.getByText(/^Input \d+$/)).toHaveText(["Input 0"]);
});

test("a signTx request shows none of the signPskt rows", async ({ page }) => {
  await open(page, "tx=v0mixed");
  await expect(page.getByText("Inputs you sign")).toHaveCount(0);
  await expect(page.getByText("Sign only")).toHaveCount(0);
});

// The badge names the account's network when the request carries none:
// signPskt never sends networkId, and signTx's is optional.
test("signPskt: the network badge reads the account's network", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0mixed&pskt=0:All&network=mainnet");
  await expect(page.getByText("Mainnet", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("signTx without networkId: the badge reads the account's network", async ({
  page,
}) => {
  const errors = await open(page, "tx=v0&nonet=1");
  await expect(page.getByText("Testnet | T10", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
