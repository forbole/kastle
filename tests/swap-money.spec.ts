import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real Swap screen, built by tests/swap-bridge-copy-logs/vite.config.mjs
// (its hooks, WASM and the KRON / Braid clients stubbed; ?kas= sets the KAS
// price). What it reads is the amount field's fiat line.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-swap-money-${process.pid}`);
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

async function openSwap(page: Page, kas: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto(`${base}/?screen=swap&kas=${kas}`);
  await expect(page.getByText("Swap", { exact: true }).first()).toBeVisible();
  return errors;
}

/** The fiat line under the amount field, or null when none renders. */
const amountFiat = (page: Page) =>
  page.evaluate(() => {
    const input = document.querySelector("input[inputmode=decimal]");
    const box = input?.closest("div.flex.flex-col.items-center");
    const line = [...(box?.querySelectorAll("span") ?? [])]
      .map((s) => (s as HTMLElement).innerText.trim())
      .find((t) => t.includes("$"));
    return line ?? null;
  });

async function body(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  console.log(`BODY ─────\n${text}\n─────`);
  return text;
}

test("item 3: the typed amount's fiat is two decimals at or above $0.01, four significant below", async ({
  page,
}) => {
  const errors = await openSwap(page, "0.02667811");
  const input = page.locator("input[inputmode=decimal]");
  await input.fill("3");
  await expect.poll(() => amountFiat(page)).toBe("$0.08");
  await input.fill("0.1");
  // 0.1 × $0.02667811 = $0.002667811: four significant digits.
  await expect.poll(() => amountFiat(page)).toBe("$0.002668");
  await input.fill("100000");
  await expect.poll(() => amountFiat(page)).toBe("$2,667.81");
  await body(page);
  expect(errors).toEqual([]);
});
