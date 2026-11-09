import { expect, test } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// QA 2.61.4: Preline's HSTabs autoInit (run by PopupLayout on every route
// change) claims every [role=tablist] and throws when no child carries its
// `active` class, killing the KAS and KRC-20 detail pages.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-preline-tablist-${process.pid}`);
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/asset-detail/vite.config.mjs"),
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

for (const [key, route] of [
  ["KAS", "/kas-asset"],
  ["KRC-20", "/token-asset/KASPY"],
  ["KCC-20", `/kcc20/${"ab".repeat(32)}`],
]) {
  test(`${key} detail survives Preline autoInit`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // React Router's default error boundary catches the throw (as in the
    // popup), so it reaches the console, not pageerror.
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`${base}/?route=${encodeURIComponent(route)}`);
    // autoInit runs in an effect after the first commit; let it run.
    await page.waitForFunction(() => "HSStaticMethods" in window);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    expect(errors).toEqual([]);
    await expect(
      page.getByRole("tab", { name: "History", exact: true }),
    ).toBeVisible();
  });
}
