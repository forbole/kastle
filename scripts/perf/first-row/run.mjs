/* global process */
// E1 proof: ms from Activity mount to the first ActivityRow, storage seeded from
// a measure.mjs run (<log>.stored.json), network hung. Median of 3 fresh pages per page type.
// Usage: node scripts/perf/first-row/run.mjs <log.json.stored.json> <kaspa> <evm>
import { build } from "vite";
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const [storedFile, KASPA, EVM] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = `/tmp/perf-first-row-${process.pid}`;
await build({
  configFile: path.join(here, "vite.config.mjs"),
  build: { outDir },
});
const stored = JSON.parse(readFileSync(storedFile, "utf8"));
const seed = {
  [`local:cache:activity:feed:${EVM}:${KASPA}`]: stored.feed,
  [`local:cache:activity:kcc20:${KASPA}`]: stored.kcc20,
};
const server = http.createServer((req, res) => {
  const p = path.resolve(outDir, "." + (req.url ?? "/").split("?")[0]);
  const file =
    existsSync(p) && statSync(p).isFile() ? p : path.join(outDir, "index.html");
  res.writeHead(200, {
    "content-type":
      { ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ??
      "text/html",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
for (const type of ["swap", "bridge"]) {
  const t = [];
  let rows = 0;
  let spinning = 0;
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage({
      viewport: { width: 375, height: 600 },
    });
    page.on("pageerror", (e) => console.log("pageerror", e.message));
    await page.addInitScript((s) => (window.__stored = s), seed);
    await page.goto(`${base}/?type=${type}`);
    const ms = await page
      .waitForFunction(() => window.__firstRow, null, { timeout: 5000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    rows = await page.locator("button:has(> div.relative.size-10)").count();
    // The live read never answers here, so the refresh spinner must still run.
    spinning = await page.locator(".hn-refresh.animate-spin").count();
    t.push(ms);
    await page.close();
  }
  const ok = t.filter((x) => x !== null).sort((a, b) => a - b);
  console.log(
    `${type}: first row ${t.map((x) => (x === null ? "none in 5 s" : x.toFixed(0) + " ms")).join(" / ")}; median ${ok.length === 3 ? ok[1].toFixed(0) + " ms" : "n/a"}; ${rows} rows; refresh spinner ${spinning ? "running" : "off"}`,
  );
}
await browser.close();
server.close();
