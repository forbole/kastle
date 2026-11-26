import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Read-only proof: the Kasseal SDK web entry loads under the popup's real CSP
// and module graph, fetching the WASM the build ships, and quotes one bonding
// mainnet token with its own curve math. No wallet, no build, no signature,
// no broadcast.
const OUT = "/tmp/kasseal-popup";
const API = "https://app.kasseal.com/v1";
const SLIPPAGE_BPS = 100;
const WASM_SIZE = fs.statSync(
  path.resolve("node_modules/@kassealhq/sdk/dist/kaspa/web/kaspa_bg.wasm"),
).size;

const chunkFor = (re: RegExp) =>
  fs
    .readdirSync(path.resolve(".output/chrome-mv3/chunks"))
    .find((f) => re.test(f));

function watch(page: Page) {
  const log = {
    consoleErrors: [] as string[],
    consoleWarnings: [] as string[],
    badRequests: [] as string[],
    wasm: [] as { url: string; status: number; bytes: number }[],
  };
  page.on("console", (m) => {
    const line = m.text().split("\n")[0];
    if (m.type() === "error") log.consoleErrors.push(line);
    if (m.type() === "warning") log.consoleWarnings.push(line);
  });
  page.on("pageerror", (e) =>
    log.consoleErrors.push(`pageerror: ${e.message.split("\n")[0]}`),
  );
  page.on("requestfailed", (r) =>
    log.badRequests.push(`FAILED ${r.url()} ${r.failure()?.errorText}`),
  );
  page.on("response", async (r) => {
    if (r.status() >= 400) log.badRequests.push(`${r.status()} ${r.url()}`);
    if (r.url().endsWith(".wasm"))
      log.wasm.push({
        url: r.url(),
        status: r.status(),
        bytes: (await r.body().catch(() => Buffer.alloc(0))).length,
      });
  });
  return log;
}

test("Kasseal SDK loads in popup.html and quotes a mainnet bonding token", async ({
  page,
  extensionId,
}) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });
  const chunk = chunkFor(/^web-mainnet-.*\.js$/);
  expect(chunk).toBeTruthy();
  const log = watch(page);

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector("#root");

  const result = await page.evaluate(
    async ({ chunk, API, bps }) => {
      const out: Record<string, unknown> = {};
      const get = async (p: string) => {
        const r = await fetch(`${API}${p}`);
        if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);
        return r.json();
      };
      const t0 = performance.now();
      try {
        // Same URL the popup's lazy import resolves to → same module instance.
        const sdk = await import(`/chunks/${chunk}`);
        out.webWasmUrl = String(sdk.webWasmUrl?.());
        await sdk.initWeb({ preload: "all" });
        out.init = "ok";
        out.initMs = Math.round(performance.now() - t0);

        const list = await get(`/tokens?sort=active&limit=50`);
        const tok = (list.tokens ?? []).find(
          (t: Record<string, unknown>) => t.phase === "bonding",
        );
        if (!tok) throw new Error("no bonding token listed");
        const tokenId: string = tok.meta?.covenantId;
        out.token = { tokenId, ticker: tok.meta?.ticker, phase: tok.phase };

        // lib/kasseal/build.ts's read half, done with the SDK in the page:
        // bound launch proof → curve params → live head → buyQuote/sellQuote.
        const json = await get(
          `/tokens/${encodeURIComponent(tokenId)}/launch-proof`,
        );
        const verdict = sdk.verifyLaunchProofJson(json, "mainnet");
        out.proof = verdict.status;
        const bundle = sdk.launchProofFromJson(json);
        if (verdict.status !== "bound" || bundle.T !== tokenId)
          throw new Error(`proof ${verdict.status} for ${bundle.T}`);
        const q = bundle.params ?? {};
        const curve = {
          p0: BigInt(q.p0),
          k: BigInt(q.k),
          feeBps: BigInt(q.feeBps),
          curveLots: BigInt(q.curveLots),
        };
        const lot = BigInt(q.lot);
        const sources = sdk.createApiSources({
          baseUrl: API,
          network: "mainnet",
          tokenId,
          ownKey: "00".repeat(32), // read-only: no wallet behind it
        });
        const s0: bigint = (await sources.curveHead(bundle.C)).state.lotsSold;
        const lots = 1n;

        const buy = sdk.buyQuote(curve, s0, lots);
        const buyTotal: bigint = buy.cost + buy.fee;
        const buyServer = await get(
          `/tokens/${encodeURIComponent(tokenId)}/quote?side=buy&lots=${lots}`,
        );
        out.buy = {
          lotsSold: String(s0),
          lots: String(lots),
          amountIn: String(buyTotal),
          tradingFeeSompi: String(buy.fee),
          // A curve buy delivers exactly lots × lot (build.ts), so that is minOut.
          minOut: String(lots * lot),
          maxKasIn: String(
            buyTotal + (buyTotal * BigInt(bps) + 9999n) / 10000n,
          ),
          server: {
            totalSompi: String(buyServer.totalSompi),
            feeSompi: String(buyServer.feeSompi),
          },
        };
        if (s0 >= lots) {
          const sell: { cost: bigint; fee: bigint } = sdk.sellQuote(
            curve,
            s0,
            lots,
          );
          const net = sell.cost - sell.fee;
          const sellServer = await get(
            `/tokens/${encodeURIComponent(tokenId)}/quote?side=sell&lots=${lots}`,
          );
          out.sell = {
            amountIn: String(lots * lot),
            expectedOut: String(net),
            tradingFeeSompi: String(sell.fee),
            minOut: String(sdk.minWithSlippage(net, bps)),
            server: {
              totalSompi: String(sellServer.totalSompi),
              feeSompi: String(sellServer.feeSompi),
            },
          };
        }
      } catch (e) {
        out.err = `ERR ${(e as Error)?.stack ?? e}`.slice(0, 800);
      }
      document.body.insertAdjacentHTML(
        "afterbegin",
        `<pre id="kasseal-proof" style="white-space:pre-wrap;font:11px monospace;background:#fff;color:#000;padding:8px">${JSON.stringify(out, null, 2)}</pre>`,
      );
      return out;
    },
    { chunk, API, bps: SLIPPAGE_BPS },
  );

  const report = { result, ...log };
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${OUT}/popup-sdk-quote.png`, fullPage: true });
  console.log(JSON.stringify(report, null, 2));

  expect(result.err).toBeUndefined();
  expect(result.init).toBe("ok");
  expect(result.webWasmUrl).toBe(
    `chrome-extension://${extensionId}/kaspa/web/kaspa_bg.wasm`,
  );
  expect(log.wasm).toContainEqual({
    url: result.webWasmUrl,
    status: 200,
    bytes: WASM_SIZE,
  });
  expect(result.proof).toBe("bound");
  const buy = result.buy as Record<string, any>;
  // The SDK's own curve math agrees with the server to the sompi.
  expect(buy.amountIn).toBe(buy.server.totalSompi);
  expect(buy.tradingFeeSompi).toBe(buy.server.feeSompi);
  expect(BigInt(buy.minOut) > 0n).toBe(true);
  expect(BigInt(buy.maxKasIn) > BigInt(buy.amountIn)).toBe(true);
  const sell = result.sell as Record<string, any> | undefined;
  if (sell) {
    expect(sell.expectedOut).toBe(sell.server.totalSompi);
    expect(sell.tradingFeeSompi).toBe(sell.server.feeSompi);
    expect(BigInt(sell.minOut) < BigInt(sell.expectedOut)).toBe(true);
  }
  expect(log.badRequests).toEqual([]);
});

test("Kasseal SDK testnet-10 entry loads the same shipped WASM", async ({
  page,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const chunk = chunkFor(/^web-testnet-10-.*\.js$/);
  expect(chunk).toBeTruthy();
  const log = watch(page);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector("#root");
  const result = await page.evaluate(async (chunk) => {
    try {
      const sdk = await import(`/chunks/${chunk}`);
      const webWasmUrl = String(sdk.webWasmUrl?.());
      await sdk.initWeb({ preload: "all" });
      return { webWasmUrl, init: "ok" };
    } catch (e) {
      return { init: `ERR ${(e as Error)?.stack ?? e}`.slice(0, 800) };
    }
  }, chunk);
  console.log(JSON.stringify({ result, ...log }, null, 2));
  expect(result.init).toBe("ok");
  expect(result.webWasmUrl).toBe(
    `chrome-extension://${extensionId}/kaspa/web/kaspa_bg.wasm`,
  );
  expect(log.wasm.map((w) => [w.status, w.bytes])).toContainEqual([
    200,
    WASM_SIZE,
  ]);
});
