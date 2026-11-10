import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The send picker's KCC-20 row (QA issue 3), real component, real
// fillFromKrc20; only the wallet and the KRC-20 list are stubbed
// (tests/asset-select/stubs.tsx).
const NACHO_COVID = "41".repeat(32);
const NACHO_LOGO = "https://x/nacho.png";

let base = "";
let server: http.Server | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const outDir = path.join(tmpdir(), `kastle-asset-select-${process.pid}`);
  mkdirSync(outDir, { recursive: true });
  // vite.build sets NODE_ENV=production in this worker; keep it for React.
  const env = process.env.NODE_ENV;
  await build({
    configFile: "tests/asset-select/vite.config.mjs",
    root: "tests/asset-select",
    logLevel: "error",
    build: { outDir },
  });
  process.env.NODE_ENV = env;
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
    const types: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "text/html",
    });
    res.end(readFileSync(file));
  });
  base = await new Promise<string>((r) =>
    server!.listen(0, "127.0.0.1", () =>
      r(`http://127.0.0.1:${(server!.address() as { port: number }).port}`),
    ),
  );
});

test.afterAll(() => {
  server?.close();
});

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Image URLs are fake; answer them so the row keeps the src.
  await page.route("https://x/**", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }),
  );
  await page.goto(`${base}/?${query}`);
  const row = page.getByRole("button").filter({ hasText: "NACHO" });
  await expect(row).toBeVisible();
  return { errors, row, img: row.getByRole("img", { name: "Token" }) };
}

test("the NACHO picker row takes its logo from the one KRC-20 namesake", async ({
  page,
}) => {
  const { errors, img } = await open(page, "krc20=1");
  await expect(img).toHaveAttribute("src", NACHO_LOGO);
  expect(errors).toEqual([]);
});

test("two KRC-20 namesakes fill nothing: the row keeps the fallback logo", async ({
  page,
}) => {
  const { errors, img } = await open(page, "krc20=2");
  await expect(img).not.toHaveAttribute("src", NACHO_LOGO);
  await expect(img).toHaveAttribute("src", /^data:image\/svg\+xml,/);
  expect(errors).toEqual([]);
});

test("an issuer-claimed row shows no Unverified chip", async ({ page }) => {
  for (const query of ["krc20=0", "krc20=1"]) {
    const { row } = await open(page, query);
    await expect(row.getByText("Unverified", { exact: true })).toHaveCount(0);
  }
});

test("the row opens the send form by covenant id with its metadata unfilled", async ({
  page,
}) => {
  const { row } = await open(page, "krc20=1");
  // The display fill never reaches the row object the send flow is keyed by.
  const meta = await page.evaluate(
    () => (window as unknown as { __row: { meta: object } }).__row.meta,
  );
  expect(meta).toEqual({
    symbol: "NACHO",
    name: "Nacho",
    decimals: 8,
    unverified: true,
  });
  await row.click();
  await expect(page.getByTestId("landed")).toHaveText(
    `/kcc20/send/${NACHO_COVID}`,
  );
});
