import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real Bridge and Swap screens, built by
// tests/swap-bridge-copy-logs/vite.config.mjs with their hooks and the WASM
// stubbed: a failed submit puts "Copy logs" in the pinned action bar, its
// report built from the thrown value, never from the toast's copy. viem is
// real: the Kasplex and Igra RPCs are answered here.

const RPC = "https://evmrpc.kasplex.org/";
const ADDRESS =
  "kaspa:qr0lr4ml9fn3chekrqmjdkergxl93l4wrk3dankcgvjq776s9wn9jkdskewva";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-sb-copy-logs-${process.pid}`);
  // vite.build sets NODE_ENV=production in the worker; restore it for the
  // React specs that run after in the same worker.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/swap-bridge-copy-logs/vite.config.mjs"),
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

/** Opens the Bridge in a 600 px popup with a clipboard that records. */
async function open(page: Page, scenario: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          (window as unknown as { __clip: string }).__clip = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto(`${base}/?scenario=${scenario}`);
  return errors;
}

const confirm = (page: Page) =>
  page.getByRole("button", { name: "Confirm", exact: true });

/** Confirms, then waits for the failure: `toast` shown, or a "failed" emit. */
async function submit(page: Page, amount: string, toast?: string) {
  await page.locator("input").first().fill(amount);
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
  if (toast) await expect(page.getByText(toast)).toBeVisible();
  else
    await expect
      .poll(() => page.evaluate(() => window.__bridge.emitted))
      .toEqual(["failed"]);
}

async function copied(page: Page) {
  await page.getByRole("button", { name: "Copy logs" }).click();
  const text = await page.evaluate(
    () => (window as unknown as { __clip?: string }).__clip,
  );
  expect(text).toBeTruthy();
  expect(text).not.toContain("kaspa:");
  expect(text).not.toMatch(/[0-9a-f]{64}/i);
  return JSON.parse(text!);
}

/** Copy logs sits above Confirm, apart from it; Confirm stays on screen and takes its own press. */
async function expectConfirmUnblocked(page: Page) {
  const copy = (await page
    .getByRole("button", { name: "Copy logs" })
    .boundingBox())!;
  const button = (await confirm(page).boundingBox())!;
  expect(copy.y + copy.height).toBeLessThanOrEqual(button.y);
  expect(button.y + button.height).toBeLessThanOrEqual(600);
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent,
    [button.x + button.width / 2, button.y + button.height / 2],
  );
  expect(hit).toBe("Confirm");
}

test("L1 build fails: Copy logs carries the thrown reason and cause, scrubbed", async ({
  page,
}) => {
  const errors = await open(page, "node");
  await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(0);
  await submit(page, "100");
  // the toast keeps its generic copy: the node's text is only in the report
  await expect(
    page.getByText("Bridge failed. Please try again."),
  ).toBeVisible();
  const report = await copied(page);
  expect(report.flow).toBe("bridge");
  expect(report.direction).toBe("kas-igra");
  expect(report.error).toContain("Storage mass exceeds maximum");
  expect(report.error).toContain("[ADDRESS]");
  expect(report.cause).toContain("mass 120000 > 100000");
  expect(report.extensionVersion).toBe("9.9.9");
  expect(report.walletType).toBe("hot");
  await expectConfirmUnblocked(page);
  expect(errors).toEqual([]);
});

test("EVM leg fails: Copy logs carries the node's JSON-RPC code", async ({
  page,
}) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  };
  const methods: string[] = [];
  await page.route(RPC, async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const { id, method } = route.request().postDataJSON();
    methods.push(method);
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: `insufficient funds for gas * price + value: address 0x00000000000000000000000000000000000000aa have 0 want 1 ${ADDRESS}`,
        },
      }),
    });
  });
  const errors = await open(page, "node");
  // Kaspa -> Kasplex, then flip: Kasplex KAS -> Kaspa (Kurve exit)
  await page.getByRole("button", { name: "iKAS" }).click();
  await page.getByRole("button", { name: "Kasplex", exact: true }).click();
  await page.getByRole("button", { name: "Token Chain KAS" }).click();
  // the pick closes the sheet itself; Escape guards against it staying open
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Flip" }).click();
  await submit(page, "20");
  expect(methods).toEqual(["eth_estimateGas"]);
  const report = await copied(page);
  expect(report.flow).toBe("bridge");
  expect(report.direction).toBe("kasplex-kas");
  expect(report.code).toBe(-32000);
  expect(report.error).toContain("insufficient funds for gas");
  expect(errors).toEqual([]);
});

test("an error whose toString throws builds no report: no copy control", async ({
  page,
}) => {
  const errors = await open(page, "hostile");
  await submit(page, "100");
  await expect(
    page.getByText("Bridge failed. Please try again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Swap: every request off the harness gets a JSON-RPC error, so the EVM legs
// fail on their first call with the node's -32000 and nothing leaves the box.
async function openSwap(page: Page, scenario: string) {
  await page.route(
    (url) => !url.href.startsWith(base),
    async (route) => {
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      };
      const req = route.request();
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors });
      if (req.method() !== "POST") return route.abort();
      const { id } = req.postDataJSON();
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: `nonce too low ${ADDRESS}` },
        }),
      });
    },
  );
  return open(page, `${scenario}&screen=swap`);
}

const sheet = (page: Page) => page.locator("dialog[open]");

/** iKAS -> KAS on Kaspa L1 -> `symbol`, the provider following the pair. */
async function pickL1(page: Page, symbol: string) {
  await page.getByRole("button", { name: "iKAS", exact: true }).first().click();
  await sheet(page).getByRole("button", { name: "Kaspa", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Select" }).click();
  await sheet(page)
    .getByRole("button", { name: new RegExp(symbol) })
    .click();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
}

for (const leg of [
  {
    name: "KRON",
    symbol: "KRN",
    flow: "kron-swap",
    reason: "KRON broadcast rejected",
    cause: "orphan transaction",
    toast: "Swap failed. Please try again.",
  },
  {
    name: "Braid",
    symbol: "BRD",
    flow: "braid-swap",
    reason: "Braid prepare refused",
    cause: "deadline passed",
    // Braid emits no swap analytics: its toast marks the failure
    toast: "Unable to prepare the swap. Please try again.",
  },
]) {
  test(`Swap ${leg.name} leg fails: Copy logs carries the thrown reason and cause, scrubbed`, async ({
    page,
  }) => {
    const errors = await openSwap(page, "node");
    await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(
      0,
    );
    await pickL1(page, leg.symbol);
    await submit(page, "1", leg.toast);
    const report = await copied(page);
    expect(report.flow).toBe(leg.flow);
    expect(report.error).toContain(leg.reason);
    expect(report.error).toContain("[ADDRESS]");
    expect(report.cause).toContain(leg.cause);
    if (leg.name === "KRON") {
      expect(report.extensionVersion).toBe("9.9.9");
      expect(report.walletType).toBe("hot");
    } else {
      // failed at prepare: no ref yet, nothing sent
      expect(report.sent).toBe(false);
    }
    await expectConfirmUnblocked(page);
    expect(errors).toEqual([]);
  });

  test(`Swap ${leg.name} leg, an error whose toString throws builds no report: no copy control`, async ({
    page,
  }) => {
    const errors = await openSwap(page, "hostile");
    await pickL1(page, leg.symbol);
    await submit(page, "1", leg.toast);
    await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
  });
}

test("Swap Braid failure, then another pair: the old report is dropped", async ({
  page,
}) => {
  const errors = await openSwap(page, "node");
  await pickL1(page, "BRD");
  await submit(page, "1", "Unable to prepare the swap. Please try again.");
  await expect(page.getByRole("button", { name: "Copy logs" })).toHaveCount(1);
  // BRD -> KRN -> BRD: the pair changed twice, no new attempt on either
  for (const symbol of ["KRN", "BRD"]) {
    await page
      .getByRole("button", { name: /^(BRD|KRN)$/ })
      .first()
      .click();
    await sheet(page)
      .getByRole("button", { name: new RegExp(symbol) })
      .click();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Copy logs" }),
      `on ${symbol}`,
    ).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("Swap EVM leg (iKAS -> WiKAS wrap) fails: Copy logs carries the node's JSON-RPC code", async ({
  page,
}) => {
  const errors = await openSwap(page, "node");
  await submit(page, "1");
  const report = await copied(page);
  expect(report.flow).toBe("swap");
  expect(report.provider).toBe("wrap");
  expect(report.code).toBe(-32000);
  expect(report.error).toContain("nonce too low");
  expect(report.walletType).toBe("hot");
  await expectConfirmUnblocked(page);
  expect(errors).toEqual([]);
});
