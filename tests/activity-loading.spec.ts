import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real Activity screen and the real useActivityFeed/feed-store, built by
// tests/activity-loading/vite.config.mjs. Only the fetcher, the wallet and
// storage are driven from here (window.__harness). Bridge page: the KCC-20
// read is Swap-only, so the feed's own SWR entry is all that runs.

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(tmpdir(), `kastle-activity-loading-${process.pid}`);
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({
      configFile: path.resolve("tests/activity-loading/vite.config.mjs"),
      build: { outDir },
    });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  server = http.createServer((req, res) => {
    const p = path.resolve(outDir, "." + (req.url ?? "/").split("?")[0]);
    const file =
      p.startsWith(outDir + path.sep) && existsSync(p) && statSync(p).isFile()
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

const EVM = "0x178F82eD0c5a5B924CD72529d0267Be5b452C337";
const A = "kaspa:qqwalleta";
const B = "kaspa:qqwalletb";
const storeKey = (kaspa: string) =>
  `local:cache:activity:feed:bridge:${EVM}:${kaspa}`;

const kurve = (originTxHash: string, status: "PENDING" | "COMPLETED") => ({
  type: "bridge_kurve",
  data: {
    originTxHash,
    direction: "l2-to-l1",
    amount: "12",
    tokenSymbol: "KAS",
    status,
    destTxHash: null,
    timestampMs: Date.UTC(2026, 10, 27, 12),
  },
});
const feed = (...items: unknown[]) => ({
  items,
  swapHistory: { swaps: [], degraded: [] },
  bridgeSource: null,
  depositSource: null,
  kurveSource: null,
});
/** Stored copy: one exit still Bridging. Live: the same exit, Bridged. */
const STORED = feed(kurve("0xa", "PENDING"));
const LIVE = feed(kurve("0xa", "COMPLETED"));

type Harness = {
  kaspa: string;
  evm: string;
  mode: "hold" | "fail" | "ok";
  live: unknown;
  calls: number;
  stored: Record<string, string>;
  slow: string[];
};

async function open(page: Page, h: Partial<Harness>) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.addInitScript(
    (h) => ((window as unknown as { __harness: unknown }).__harness = h),
    {
      kaspa: A,
      evm: EVM,
      mode: "hold",
      live: LIVE,
      calls: 0,
      stored: { [storeKey(A)]: JSON.stringify(STORED) },
      slow: [],
      ...h,
    } satisfies Harness,
  );
  await page.goto(`${base}/?type=bridge`);
  return errors;
}
const set = (page: Page, patch: Partial<Harness>) =>
  page.evaluate((patch) => {
    const w = window as unknown as {
      __harness: Harness & { release?: () => void };
    };
    Object.assign(w.__harness, patch);
  }, patch);
const release = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __harness: { release: () => void } }
    ).__harness.release(),
  );
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __harness: Harness }).__harness.calls,
  );
const rows = (page: Page) => page.locator("button:has(> div.relative.size-10)");
const spinner = (page: Page) => page.locator(".hn-refresh.animate-spin");
const retry = (page: Page) => page.getByRole("button", { name: "Retry" });

test("stored rows paint while the live read runs, with the refresh spinner on, until it lands", async ({
  page,
}) => {
  const errors = await open(page, { mode: "hold" });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Bridging");
  await expect(spinner(page)).toHaveCount(1);
  await expect(page.getByLabel("Refresh")).toBeDisabled();
  await release(page);
  await expect(rows(page).first()).toContainText("Bridged");
  await expect(rows(page).first()).not.toContainText("Bridging");
  await expect(spinner(page)).toHaveCount(0);
  await expect(page.getByLabel("Refresh")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("another wallet's stored copy never stands in: a switch shows skeletons until its own read", async ({
  page,
}) => {
  const errors = await open(page, { mode: "hold", slow: [storeKey(B)] });
  await expect(rows(page)).toHaveCount(1);
  await set(page, { kaspa: B });
  await page.evaluate(() => dispatchEvent(new Event("harness-wallet")));
  await expect(page.locator(".animate-pulse").first()).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a failed live read over stored rows offers Retry, stops the spinner, and Retry replaces them", async ({
  page,
}) => {
  const errors = await open(page, { mode: "fail" });
  await expect(retry(page)).toBeVisible();
  await expect(page.getByText("Couldn't load activity.")).toBeVisible();
  // The stored rows stay, under the Retry, and the spinner does not run on.
  await expect(rows(page)).toHaveCount(1);
  await expect(spinner(page)).toHaveCount(0);
  await expect(page.getByLabel("Refresh")).toBeEnabled();
  await set(page, { mode: "ok" });
  await retry(page).click();
  await expect(rows(page).first()).toContainText("Bridged");
  await expect(retry(page)).toHaveCount(0);
  await expect(spinner(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the feed polls every 10 s while a row is in progress, every 60 s once all settle", async ({
  page,
}) => {
  await page.clock.install();
  await open(page, { mode: "ok", live: STORED, stored: {} });
  await expect(rows(page).first()).toContainText("Bridging");
  expect(await calls(page)).toBe(1);
  await page.clock.runFor(11_000);
  await expect.poll(() => calls(page)).toBe(2);

  // Settled: nothing more for the next 50 s, then the 60 s poll.
  await set(page, { live: LIVE });
  await page.clock.runFor(11_000);
  await expect.poll(() => calls(page)).toBe(3);
  await expect(rows(page).first()).toContainText("Bridged");
  await page.clock.runFor(50_000);
  expect(await calls(page)).toBe(3);
  await page.clock.runFor(11_000);
  await expect.poll(() => calls(page)).toBe(4);
});
