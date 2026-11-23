import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { numberToHex, parseEther, parseGwei } from "viem";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real dApp SendTransaction screen, built by
// tests/evm-send-shortfall/vite.config.mjs with hooks and extension messaging
// stubbed. viem and lib/ethereum/transaction are real: the Kasplex RPC is
// answered here. Before the signature, gas x maxFeePerGas + value is compared
// with the native balance; a shortfall disables Confirm and says by how much.

// kasplexMainnet.rpcUrls.default (lib/layer2 imports SVGs, so not from node).
const RPC = "https://evmrpc.kasplex.org/";
const FROM = "0x00000000000000000000000000000000000000aa";
const TX_HASH = "0x" + "ab".repeat(32);

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-evm-shortfall-${process.pid}`);
  // vite.build sets NODE_ENV=production in the worker; restore it for the
  // React specs that run after in the same worker.
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/evm-send-shortfall/vite.config.mjs"),
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

type Answer =
  | { result: unknown }
  | { error: { code: number; message: string } };

// Kasplex as measured: gasPrice 2401 gwei is above baseFee x 1.2 + tip, so
// maxFeePerGas = gasPrice. 33,600 gas -> 0.0806736 KAS of gas.
function rpc(over: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    eth_chainId: { result: numberToHex(202_555) },
    eth_getBalance: { result: numberToHex(parseEther("0.0293")) },
    eth_estimateGas: { result: numberToHex(33_600) },
    eth_gasPrice: { result: numberToHex(parseGwei("2401")) },
    eth_maxPriorityFeePerGas: { result: numberToHex(parseGwei("1")) },
    eth_getBlockByNumber: {
      result: {
        number: "0x1",
        hash: "0x" + "11".repeat(32),
        parentHash: "0x" + "22".repeat(32),
        timestamp: "0x1",
        gasLimit: "0x1c9c380",
        gasUsed: "0x0",
        baseFeePerGas: numberToHex(parseGwei("1000")),
        transactions: [],
      },
    },
    eth_getTransactionCount: { result: "0x0" },
    eth_sendRawTransaction: { result: TX_HASH },
    ...over,
  };
}

async function open(
  page: Page,
  answers: Record<string, Answer>,
  tx: Record<string, string> = {},
  // eth_getBalance answers only once this resolves; `wait` = the bound in ms.
  { hold, wait }: { hold?: Promise<void>; wait?: number } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
    if (method === "eth_getBalance") await hold;
    const answer = answers[method] ?? {
      error: { code: -32601, message: `unmocked ${method}` },
    };
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, ...answer }),
    });
  });
  const payload = encodeURIComponent(
    JSON.stringify({
      from: FROM,
      to: "0x00000000000000000000000000000000000000cc",
      data: "0x12345678",
      chainId: numberToHex(202_555),
      ...tx,
    }),
  );
  await page.goto(
    `${base}/?requestId=r1&origin=page&payload=${payload}` +
      (wait ? `&wait=${wait}` : ""),
  );
  return { errors, methods };
}

const confirm = (page: Page) =>
  page.getByRole("button", { name: "Confirm", exact: true });

test("short of gas + value: both numbers shown, Confirm disabled", async ({
  page,
}) => {
  const { errors, methods } = await open(page, rpc(), {
    value: numberToHex(parseEther("0.01")),
  });
  // 33,600 x 2401 gwei + 0.01 KAS value.
  await expect(
    page.getByText(
      "Not enough KAS to pay for this transaction: it needs 0.0906736 KAS (gas + value), your balance is 0.0293 KAS.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  await confirm(page).click({ force: true });
  expect(await page.evaluate(() => window.__evmSend)).toEqual({
    responses: [],
    signed: 0,
  });
  expect(methods).not.toContain("eth_sendRawTransaction");
  expect(errors).toEqual([]);
});

test("node refuses the estimate for lack of funds: its reason and the balance, Confirm disabled", async ({
  page,
}) => {
  const { errors } = await open(
    page,
    rpc({
      eth_estimateGas: {
        error: {
          code: -32000,
          message: "gas required exceeds allowance (12183)",
        },
      },
    }),
  );
  await expect(
    page.getByText(
      "Not enough KAS to pay for gas: your balance is 0.0293 KAS. The network says: gas required exceeds allowance (12183)",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  expect(errors).toEqual([]);
});

test("enough balance: no notice, Confirm enabled, signs and returns the hash as today", async ({
  page,
}) => {
  const { errors } = await open(
    page,
    rpc({ eth_getBalance: { result: numberToHex(parseEther("0.536")) } }),
  );
  // Let the balance check (if any) settle; passes on the pre-fix screen too.
  await page.waitForLoadState("networkidle");
  await expect(confirm(page)).toBeEnabled();
  await expect(page.getByText("Not enough KAS")).toHaveCount(0);
  await expect(page.getByText("Couldn't check")).toHaveCount(0);
  await confirm(page).click();
  await expect
    .poll(() => page.evaluate(() => window.__evmSend.responses))
    .toEqual([{ id: "r1", response: TX_HASH }]);
  expect(await page.evaluate(() => window.__evmSend.signed)).toBe(1);
  expect(errors).toEqual([]);
});

test("balance unreadable: says so and still lets the user confirm", async ({
  page,
}) => {
  const { errors } = await open(
    page,
    rpc({ eth_getBalance: { error: { code: -32603, message: "boom" } } }),
  );
  await expect(
    page.getByText(
      "Couldn't check that your KAS balance covers this transaction's fee. You can still confirm.",
    ),
  ).toBeVisible();
  await expect(confirm(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

// Confirm clicked while the balance check is still in flight.
function gate() {
  let open!: () => void;
  const hold = new Promise<void>((r) => (open = r));
  return { hold, open };
}
const COULDNT_CHECK =
  "Couldn't check that your KAS balance covers this transaction's fee. You can still confirm.";

test("Confirm while the check is pending: signs once, only after the balance answers", async ({
  page,
}) => {
  const balance = gate();
  const { errors } = await open(
    page,
    rpc({ eth_getBalance: { result: numberToHex(parseEther("0.536")) } }),
    {},
    { hold: balance.hold },
  );
  await expect(confirm(page)).toBeEnabled();
  // A handle: while signing the button shows a spinner, not "Confirm".
  const button = await confirm(page).elementHandle();
  await button!.click();
  await button!.click({ force: true });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__evmSend)).toEqual({
    responses: [],
    signed: 0,
  });
  balance.open();
  await expect
    .poll(() => page.evaluate(() => window.__evmSend.responses))
    .toEqual([{ id: "r1", response: TX_HASH }]);
  expect(await page.evaluate(() => window.__evmSend.signed)).toBe(1);
  expect(errors).toEqual([]);
});

test("Confirm while the check is pending, balance answers short: no signature, shortfall shown", async ({
  page,
}) => {
  const balance = gate();
  const { errors, methods } = await open(
    page,
    rpc(),
    {},
    { hold: balance.hold },
  );
  await confirm(page).click();
  balance.open();
  await expect(
    page.getByText(
      "Not enough KAS to pay for this transaction: it needs 0.0806736 KAS (gas + value), your balance is 0.0293 KAS.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__evmSend)).toEqual({
    responses: [],
    signed: 0,
  });
  expect(methods).not.toContain("eth_sendRawTransaction");
  expect(errors).toEqual([]);
});

test("check does not answer inside the bound: signs once under the couldn't-check line", async ({
  page,
}) => {
  const balance = gate();
  const { errors } = await open(
    page,
    rpc(),
    {},
    { hold: balance.hold, wait: 300 },
  );
  // A handle: while signing the button shows a spinner, not "Confirm".
  const button = await confirm(page).elementHandle();
  await button!.click();
  await button!.click({ force: true });
  await expect
    .poll(() => page.evaluate(() => window.__evmSend.responses))
    .toEqual([{ id: "r1", response: TX_HASH }]);
  expect(await page.evaluate(() => window.__evmSend.signed)).toBe(1);
  await expect(page.getByText(COULDNT_CHECK, { exact: true })).toBeVisible();
  await expect(page.getByText("Not enough KAS")).toHaveCount(0);
  balance.open();
  expect(errors).toEqual([]);
});
