import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real Bridge screen, built by tests/swap-bridge-copy-logs/vite.config.mjs
// with its hooks and the WASM stubbed: a failed submit puts "Copy logs" in the
// pinned action bar, its report built from the thrown value, never from the
// toast's copy. viem is real: the Kasplex RPC is answered here.

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

async function submit(page: Page, amount: string) {
  await page.locator("input").first().fill(amount);
  await expect(confirm(page)).toBeEnabled();
  await confirm(page).click();
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

test("a report that cannot be scrubbed renders no copy control", async ({
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
