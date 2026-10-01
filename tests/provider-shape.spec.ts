import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Drives the real built provider (npm run build first), with a stub standing
// in for content.ts's page bridge.
const INJECTED = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.output/chrome-mv3/injected.js",
);

test("window.kastle serves both request shapes and emits connect", async ({
  page,
}) => {
  test.skip(!fs.existsSync(INJECTED), "run `npm run build` first");

  await page.route("https://dapp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://dapp.test/");
  await page.addScriptTag({ content: fs.readFileSync(INJECTED, "utf8") });

  const result = await page.evaluate(async () => {
    const provider = (window as any).kastle;
    // Stub bridge: answer every ApiRequest with the network id.
    window.addEventListener("message", (e) => {
      if (e.data?.target !== "background") return;
      window.postMessage(
        {
          id: e.data.id,
          response: "testnet-10",
          source: "background",
          target: "browser",
        },
        window.location.origin,
      );
    });

    const connected = new Promise((resolve) => provider.on("connect", resolve));
    window.dispatchEvent(new Event("kastle#initialized"));

    return {
      legacy: await provider.request("kas:get_network"),
      object: await provider.request({ method: "kas:get_network" }),
      legacyUnknown: String(await provider.request("kaspa_accounts")),
      objectUnknown: await provider.request({ method: "kaspa_accounts" }).then(
        () => "resolved",
        (e: { code: number }) => e.code,
      ),
      objectInherited: await provider.request({ method: "constructor" }).then(
        () => "resolved",
        (e: { code: number }) => e.code,
      ),
      connect: await connected,
      sameInstance: provider.on("accountsChanged", () => {}) === provider,
    };
  });

  expect(result).toEqual({
    legacy: "testnet-10",
    object: "testnet-10",
    legacyUnknown: "undefined",
    objectUnknown: 4200,
    objectInherited: 4200,
    connect: { networkId: "testnet-10" },
    sameInstance: true,
  });
});

test("window.kastle replays connect to listeners added after init", async ({
  page,
}) => {
  test.skip(!fs.existsSync(INJECTED), "run `npm run build` first");

  await page.route("https://dapp.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://dapp.test/");
  await page.addScriptTag({ content: fs.readFileSync(INJECTED, "utf8") });

  const connect = await page.evaluate(async () => {
    const provider = (window as any).kastle;
    // Stub bridge: answer every ApiRequest with the network id.
    window.addEventListener("message", (e) => {
      if (e.data?.target !== "background") return;
      window.postMessage(
        {
          id: e.data.id,
          response: "testnet-10",
          source: "background",
          target: "browser",
        },
        window.location.origin,
      );
    });

    window.dispatchEvent(new Event("kastle#initialized"));
    // The bridge answers in order, so once this resolves the init-time
    // GET_NETWORK has settled and connect has already been emitted.
    await provider.request("kas:get_network");

    return new Promise((resolve) => provider.on("connect", resolve));
  });

  expect(connect).toEqual({ networkId: "testnet-10" });
});
