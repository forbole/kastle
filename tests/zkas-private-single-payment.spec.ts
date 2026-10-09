import { chromium, expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Keyring } from "@/lib/keyring-manager";

const origin = "http://localhost:8765";
const bearer = "a".repeat(64);
const fvk = "b".repeat(192);
const token = "c".repeat(32);
const account = {
  walletId: "wallet-1",
  accountIndex: 0,
  network: "mainnet" as const,
  address: "zkas:dummy-address",
};
const txid = "d".repeat(64);

async function fixture() {
  const values = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  });
  values.set("local:settings", {
    networkId: "mainnet",
    zkasDaemonUrls: { mainnet: origin },
  });
  const keyring = new Keyring(`private-payment-${crypto.randomUUID()}`);
  await keyring.initialize("dummy-password");
  let permission = true;
  const delivered: unknown[] = [];
  Object.assign(globalThis, {
    browser: {
      runtime: {
        getURL: (path: string) => `chrome-extension://example${path}`,
      },
      permissions: { contains: async () => permission },
      alarms: { clear: async () => undefined },
      tabs: {
        sendMessage: async (_tab: number, message: unknown) => {
          delivered.push(message);
          return { accepted: true, origin: "https://merchant.example" };
        },
      },
    },
    __privateDeps: {
      keyring,
      credentials: async () => ({
        ...account,
        keyringVersion: keyring.getSessionVersion(),
        fullViewingKeyHex: fvk,
        walletToken: token,
        daemonUrl: origin,
      }),
      publicAccount: async () => account,
      checkSelection: async () => {
        if (!keyring.isUnlocked()) throw new Error("Selected account changed");
      },
      sign: async () => [{ index: 0, sig: "e".repeat(128) }],
    },
  });
  const result = await build({
    stdin: {
      contents: `export { zkasPaymentSendOrdinary, zkasPaymentSendWebsite } from "${resolve("lib/service/handlers/zkas-payment.ts")}";
export { zkasDappComplete } from "${resolve("lib/service/handlers/zkas-dapp.ts")}";
export { zkasDappPendingStore } from "${resolve("lib/zkas/dapp-payment.ts")}";
export { zkasConnectionStore } from "${resolve("lib/zkas/connection.ts")}";
export { withZKasPaymentAccountGate } from "${resolve("lib/zkas/payment-account-gate.ts")}";`,
      resolveDir: resolve("."),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
    loader: { ".svg": "text", ".wasm": "binary" },
    plugins: [
      {
        name: "private-account",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/lib\/zkas\/key-service$/ }, () => ({
            path: "key-service",
            namespace: "payment-mock",
          }));
          plugin.onResolve(
            { filter: /^@\/contexts\/SettingsContext$/ },
            () => ({ path: "settings", namespace: "payment-mock" }),
          );
          plugin.onResolve({ filter: /^\.\.\/extension-service$/ }, () => ({
            path: "extension-service",
            namespace: "payment-mock",
          }));
          plugin.onResolve(
            { filter: /^@\/lib\/service\/extension-service$/ },
            () => ({ path: "extension-service", namespace: "payment-mock" }),
          );
          plugin.onLoad(
            { filter: /.*/, namespace: "payment-mock" },
            (args) => ({
              loader: "js",
              contents:
                args.path === "settings"
                  ? "export const SETTINGS_KEY='local:settings';"
                  : args.path === "extension-service"
                    ? "export const ExtensionService={getInstance:()=>({getKeyring:()=>globalThis.__privateDeps.keyring})};"
                    : "export const zkasKeyService={credentials:async()=>globalThis.__privateDeps.credentials(),publicAccount:async()=>globalThis.__privateDeps.publicAccount(),checkSelection:async(...args)=>globalThis.__privateDeps.checkSelection(...args),sign:async(input)=>globalThis.__privateDeps.sign(input)};",
            }),
          );
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), "zkas-private-payment-"));
  const file = join(dir, "handler.mjs");
  writeFileSync(file, result.outputFiles[0].contents);
  stop();
  const module = (await import(
    pathToFileURL(file).href
  )) as typeof import("@/lib/service/handlers/zkas-payment") & {
    zkasDappComplete: typeof import("@/lib/service/handlers/zkas-dapp").zkasDappComplete;
    zkasDappPendingStore: typeof import("@/lib/zkas/dapp-payment").zkasDappPendingStore;
    zkasConnectionStore: typeof import("@/lib/zkas/connection").zkasConnectionStore;
    withZKasPaymentAccountGate: typeof import("@/lib/zkas/payment-account-gate").withZKasPaymentAccountGate;
  };
  const calls: {
    path: string;
    authorization: string | null;
    token: string | null;
    body?: string;
  }[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      authorization: headers.get("Authorization"),
      token: headers.get("X-Wallet-Token"),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    const response =
      path === "/api/status"
        ? {
            has_wallet: false,
            address: null,
            network: "mainnet",
            node_connected: true,
            daa_score: 765,
            synced: true,
          }
        : path === "/api/wallet/watch"
          ? { address: account.address }
          : path === "/api/wallet/balance"
            ? { balance_sompi: "42" }
            : path === "/api/wallet/prepare"
              ? {
                  session: "f".repeat(32),
                  bundle_hex: "aa",
                  amount_sompi_exact: "1",
                  fee_sompi_exact: "1",
                  remaining_sompi_exact: "0",
                  disclosure: [],
                  spend_auth: [],
                }
              : path === "/api/wallet/submit"
                ? { txid, amount_sompi_exact: "1", fee_sompi_exact: "1" }
                : { unexpected: true };
    return new Response(JSON.stringify(response), { status: 200 });
  };
  const dummyFetch = globalThis.fetch;
  return {
    module,
    keyring,
    calls,
    delivered,
    values,
    pair: async () => {
      const { DaemonBearerStore } = await import("@/lib/zkas/daemon-bearer");
      // Pair in the same bundled keyring implementation used by the handler.
      return new DaemonBearerStore(keyring).pair(
        origin,
        bearer,
        async () => undefined,
      );
    },
    setPermission: (value: boolean) => {
      permission = value;
    },
    setFetch: (replacement: typeof fetch) => {
      globalThis.fetch = replacement;
    },
    dummyFetch,
    cleanup: () => {
      globalThis.fetch = fetchOriginal;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ordinarySender = {
  id: "example",
  url: "chrome-extension://example/popup.html#/zkas/send",
} as chrome.runtime.MessageSender;
const websiteSender = {
  id: "example",
  url: "chrome-extension://example/popup.html?approvalId=11111111-1111-4111-8111-111111111111#/zkas-send",
  tab: { windowId: 42 },
} as chrome.runtime.MessageSender;

async function invoke(
  method: (
    request: never,
    respond: (value: unknown) => void,
    sender: chrome.runtime.MessageSender,
  ) => Promise<void>,
  request: object,
  sender: chrome.runtime.MessageSender,
) {
  let response: unknown;
  await method(
    request as never,
    (value) => {
      response = value;
    },
    sender,
  );
  return response;
}

test("ordinary approved payment stays in background and exposes only actual result", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    const request = {
      method: "ZKAS_PAYMENT_SEND_ORDINARY",
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      memo: "memo",
      expectedAccount: account,
    };
    await expect(
      invoke(flow.module.zkasPaymentSendOrdinary, request, {
        ...ordinarySender,
        url: ordinarySender.url?.replace(
          "#/zkas/send",
          "?approvalId=wrong#/zkas/send",
        ),
      }),
    ).rejects.toThrow();
    const response = await invoke(
      flow.module.zkasPaymentSendOrdinary,
      request,
      ordinarySender,
    );
    expect(response).toEqual({
      status: "submitted",
      txid,
      daemonReportedFeeSompi: "1",
    });
    expect(flow.calls.map((call) => call.path)).toEqual([
      "/api/status",
      "/api/wallet/watch",
      "/api/wallet/balance",
      "/api/wallet/prepare",
      "/api/wallet/submit",
    ]);
    expect(
      flow.calls.every(
        (call) =>
          call.authorization === `Bearer ${bearer}` && call.token === token,
      ),
    ).toBe(true);
    expect(JSON.stringify(response)).not.toContain(fvk);
    expect(JSON.stringify(response)).not.toContain(bearer);
  } finally {
    flow.cleanup();
  }
});

test("maximum escaped memo fits fixed prepare body and oversized memo stops before proof", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    const base = {
      method: "ZKAS_PAYMENT_SEND_ORDINARY",
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      expectedAccount: account,
    };
    const accepted = await invoke(
      flow.module.zkasPaymentSendOrdinary,
      { ...base, memo: "\u0001".repeat(512) },
      ordinarySender,
    );
    expect(accepted).toMatchObject({ status: "submitted", txid });
    const prepare = flow.calls.find(
      (call) => call.path === "/api/wallet/prepare",
    );
    expect(
      new TextEncoder().encode(prepare?.body ?? "").length,
    ).toBeGreaterThan(2_048);
    expect(
      new TextEncoder().encode(prepare?.body ?? "").length,
    ).toBeLessThanOrEqual(4_096);
    await expect(
      invoke(
        flow.module.zkasPaymentSendOrdinary,
        { ...base, memo: "x".repeat(513) },
        ordinarySender,
      ),
    ).rejects.toThrow();
    expect(
      flow.calls.filter((call) => call.path === "/api/wallet/prepare"),
    ).toHaveLength(1);
  } finally {
    flow.cleanup();
  }
});

test("private permission revocation after proof preparation stops before submit", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    flow.setFetch(async (input, init) => {
      const response = await flow.dummyFetch(input, init);
      if (new URL(String(input)).pathname === "/api/wallet/prepare")
        flow.setPermission(false);
      return response;
    });
    const response = await invoke(
      flow.module.zkasPaymentSendOrdinary,
      {
        method: "ZKAS_PAYMENT_SEND_ORDINARY",
        to: "zkas:recipient",
        amountSompi: "1",
        maxFeeSompi: "2",
        expectedAccount: account,
      },
      ordinarySender,
    );
    expect(response).toMatchObject({ status: "failed" });
    expect(flow.calls.some((call) => call.path === "/api/wallet/submit")).toBe(
      false,
    );
  } finally {
    flow.cleanup();
  }
});

test("signer failure cannot echo private account or daemon credentials", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    (
      globalThis as typeof globalThis & {
        __privateDeps: { sign: () => Promise<never> };
      }
    ).__privateDeps.sign = async () => {
      throw new Error(`${fvk} ${bearer}`);
    };
    const response = await invoke(
      flow.module.zkasPaymentSendOrdinary,
      {
        method: "ZKAS_PAYMENT_SEND_ORDINARY",
        to: "zkas:recipient",
        amountSompi: "1",
        maxFeeSompi: "2",
        expectedAccount: account,
      },
      ordinarySender,
    );
    expect(response).toMatchObject({ status: "failed" });
    expect(JSON.stringify(response)).not.toContain(fvk);
    expect(JSON.stringify(response)).not.toContain(bearer);
    expect(flow.calls.some((call) => call.path === "/api/wallet/submit")).toBe(
      false,
    );
  } finally {
    flow.cleanup();
  }
});

test("fee-like signer errors cannot append private credentials to a public result", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    (
      globalThis as typeof globalThis & {
        __privateDeps: { sign: () => Promise<never> };
      }
    ).__privateDeps.sign = async () => {
      throw new Error(
        `ZKas daemon proposes a fee of 1 ZKAS, above your 0 ZKAS maximum. ${fvk} ${bearer}`,
      );
    };
    const response = await invoke(
      flow.module.zkasPaymentSendOrdinary,
      {
        method: "ZKAS_PAYMENT_SEND_ORDINARY",
        to: "zkas:recipient",
        amountSompi: "1",
        maxFeeSompi: "2",
        expectedAccount: account,
      },
      ordinarySender,
    );
    expect(response).toMatchObject({ status: "failed" });
    expect(JSON.stringify(response)).not.toContain(fvk);
    expect(JSON.stringify(response)).not.toContain(bearer);
  } finally {
    flow.cleanup();
  }
});

test("lost submit response remains typed uncertain and reserves the account", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    flow.setFetch(async (input, init) => {
      if (new URL(String(input)).pathname === "/api/wallet/submit")
        throw new TypeError("dummy response lost");
      return flow.dummyFetch(input, init);
    });
    const request = {
      method: "ZKAS_PAYMENT_SEND_ORDINARY",
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      expectedAccount: account,
    };
    expect(
      await invoke(
        flow.module.zkasPaymentSendOrdinary,
        request,
        ordinarySender,
      ),
    ).toEqual({ status: "uncertain" });
    expect(
      await invoke(
        flow.module.zkasPaymentSendOrdinary,
        request,
        ordinarySender,
      ),
    ).toMatchObject({ status: "failed" });
    expect(
      flow.calls.filter((call) => call.path === "/api/wallet/prepare"),
    ).toHaveLength(1);
  } finally {
    flow.cleanup();
  }
});

test("submit accepts 512 bounded signatures and refuses 513 before fetch", async () => {
  const accepted = await fixture();
  try {
    await accepted.pair();
    (
      globalThis as typeof globalThis & {
        __privateDeps: {
          sign: () => Promise<{ index: number; sig: string }[]>;
        };
      }
    ).__privateDeps.sign = async () =>
      Array.from({ length: 512 }, (_, index) => ({
        index,
        sig: "e".repeat(128),
      }));
    const request = {
      method: "ZKAS_PAYMENT_SEND_ORDINARY",
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      expectedAccount: account,
    };
    expect(
      await invoke(
        accepted.module.zkasPaymentSendOrdinary,
        request,
        ordinarySender,
      ),
    ).toMatchObject({ status: "submitted", txid });
    const body =
      accepted.calls.find((call) => call.path === "/api/wallet/submit")?.body ??
      "";
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(131_072);
    expect(JSON.parse(body).sigs).toHaveLength(512);
  } finally {
    accepted.cleanup();
  }

  const rejected = await fixture();
  try {
    await rejected.pair();
    (
      globalThis as typeof globalThis & {
        __privateDeps: {
          sign: () => Promise<{ index: number; sig: string }[]>;
        };
      }
    ).__privateDeps.sign = async () =>
      Array.from({ length: 513 }, (_, index) => ({
        index,
        sig: "e".repeat(128),
      }));
    const request = {
      method: "ZKAS_PAYMENT_SEND_ORDINARY",
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      expectedAccount: account,
    };
    expect(
      await invoke(
        rejected.module.zkasPaymentSendOrdinary,
        request,
        ordinarySender,
      ),
    ).toMatchObject({ status: "failed" });
    expect(
      rejected.calls.some((call) => call.path === "/api/wallet/submit"),
    ).toBe(false);
  } finally {
    rejected.cleanup();
  }
});

test("website disconnect during delivery retains actual success but withholds page result", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    const pending = {
      approvalId: "11111111-1111-4111-8111-111111111111",
      pageRequestId: "page-1",
      tabId: 7,
      frameId: 0,
      origin: "https://merchant.example",
      account,
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      createdAt: Date.now(),
      windowId: 42,
    };
    await flow.module.zkasConnectionStore.add(pending.origin, account);
    await flow.module.zkasDappPendingStore.acquire(pending);
    (
      globalThis as typeof globalThis & {
        browser: { alarms: { clear: () => Promise<void> } };
      }
    ).browser.alarms.clear = async () => {
      await flow.module.zkasConnectionStore.remove(pending.origin);
    };
    const result = await invoke(
      flow.module.zkasPaymentSendWebsite,
      { method: "ZKAS_PAYMENT_SEND_WEBSITE", approvalId: pending.approvalId },
      websiteSender,
    );
    expect(result).toEqual({
      status: "submitted",
      txid,
      daemonReportedFeeSompi: "1",
      delivered: false,
    });
    expect(flow.delivered).toHaveLength(0);
  } finally {
    flow.cleanup();
  }
});

test("website daemon permission loss during delivery withholds page result", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    const pending = {
      approvalId: "11111111-1111-4111-8111-111111111111",
      pageRequestId: "page-1",
      tabId: 7,
      frameId: 0,
      origin: "https://merchant.example",
      account,
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      createdAt: Date.now(),
      windowId: 42,
    };
    await flow.module.zkasConnectionStore.add(pending.origin, account);
    await flow.module.zkasDappPendingStore.acquire(pending);
    (
      globalThis as typeof globalThis & {
        browser: { alarms: { clear: () => Promise<void> } };
      }
    ).browser.alarms.clear = async () => {
      flow.setPermission(false);
    };
    const result = await invoke(
      flow.module.zkasPaymentSendWebsite,
      { method: "ZKAS_PAYMENT_SEND_WEBSITE", approvalId: pending.approvalId },
      websiteSender,
    );
    expect(result).toEqual({
      status: "submitted",
      txid,
      daemonReportedFeeSompi: "1",
      delivered: false,
    });
    expect(flow.delivered).toHaveLength(0);
  } finally {
    flow.cleanup();
  }
});

test("website popup closure during proof preparation blocks submit", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    const pending = {
      approvalId: "11111111-1111-4111-8111-111111111111",
      pageRequestId: "page-1",
      tabId: 7,
      frameId: 0,
      origin: "https://merchant.example",
      account,
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      createdAt: Date.now(),
      windowId: 42,
    };
    await flow.module.zkasConnectionStore.add(pending.origin, account);
    await flow.module.zkasDappPendingStore.acquire(pending);
    flow.setFetch(async (input, init) => {
      const response = await flow.dummyFetch(input, init);
      if (new URL(String(input)).pathname === "/api/wallet/prepare")
        await flow.module.zkasDappPendingStore.takeByWindow(42);
      return response;
    });
    const result = await invoke(
      flow.module.zkasPaymentSendWebsite,
      { method: "ZKAS_PAYMENT_SEND_WEBSITE", approvalId: pending.approvalId },
      websiteSender,
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(flow.calls.some((call) => call.path === "/api/wallet/submit")).toBe(
      false,
    );
    expect(flow.delivered).toHaveLength(0);
  } finally {
    flow.cleanup();
  }
});

test("website payment consumes stored effects and delivers only its real result", async () => {
  const flow = await fixture();
  try {
    await flow.pair();
    const pending = {
      approvalId: "11111111-1111-4111-8111-111111111111",
      pageRequestId: "page-1",
      tabId: 7,
      frameId: 0,
      origin: "https://merchant.example",
      account,
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      memo: "memo",
      createdAt: Date.now(),
      windowId: 42,
    };
    await flow.module.zkasConnectionStore.add(pending.origin, account);
    await flow.module.zkasDappPendingStore.acquire(pending);
    await expect(
      invoke(
        flow.module.zkasPaymentSendWebsite,
        {
          method: "ZKAS_PAYMENT_SEND_WEBSITE",
          approvalId: pending.approvalId,
          to: "zkas:attacker",
        },
        websiteSender,
      ),
    ).rejects.toThrow();
    const response = await invoke(
      flow.module.zkasPaymentSendWebsite,
      { method: "ZKAS_PAYMENT_SEND_WEBSITE", approvalId: pending.approvalId },
      websiteSender,
    );
    expect(response).toEqual({
      status: "submitted",
      txid,
      daemonReportedFeeSompi: "1",
      delivered: true,
    });
    expect(
      flow.calls.find((call) => call.path === "/api/wallet/prepare")?.body,
    ).toContain("zkas:recipient");
    expect(flow.delivered).toHaveLength(1);
    expect(JSON.stringify(flow.delivered)).toContain(txid);
    expect(JSON.stringify(flow.delivered)).not.toContain(fvk);
    expect(JSON.stringify(flow.delivered)).not.toContain(bearer);
  } finally {
    flow.cleanup();
  }
});

test("popup cannot forge a website success or reuse an old account journal result", async () => {
  const flow = await fixture();
  try {
    const pending = {
      approvalId: "11111111-1111-4111-8111-111111111111",
      pageRequestId: "page-new",
      tabId: 7,
      frameId: 0,
      origin: "https://merchant.example",
      account,
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      createdAt: Date.now(),
      windowId: 42,
    };
    await flow.module.zkasDappPendingStore.acquire(pending);
    await expect(
      invoke(
        flow.module.zkasDappComplete,
        {
          method: "ZKAS_DAPP_COMPLETE",
          approvalId: pending.approvalId,
          outcome: { status: "success", txid, daemonReportedFeeSompi: "1" },
        },
        websiteSender,
      ),
    ).rejects.toThrow();
    expect(flow.delivered).toHaveLength(0);
    expect(
      (await flow.module.zkasDappPendingStore.get(pending.approvalId))
        ?.approvalId,
    ).toBe(pending.approvalId);
  } finally {
    flow.cleanup();
  }
});

test("actual browser website review sends only approval ID and shows background result", async () => {
  const script = await build({
    stdin: {
      contents: `import React from "react";
import { createRoot } from "react-dom/client";
import Review from "${resolve("components/screens/browser-api/zkas/ZKasDappSend.tsx")}";
createRoot(document.getElementById("root")).render(React.createElement(Review));`,
      resolveDir: resolve("."),
      loader: "ts",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
    jsx: "automatic",
    plugins: [
      {
        name: "private-review-screen",
        setup(plugin) {
          const mocks: Record<string, string> = {
            "@/components/GeneralHeader":
              "export default function Header(){return null;}",
            "@/lib/zkas/popup-client":
              "export const sendApprovedZKasWebsitePayment=(id)=>window.__approve(id);",
            "@/lib/utils":
              "export const sendMessage=(method,data)=>window.__message(method,data);",
          };
          plugin.onResolve({ filter: /^@\// }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "review-mock" }
              : undefined,
          );
          plugin.onLoad({ filter: /.*/, namespace: "review-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  stop();
  const approvalId = "11111111-1111-4111-8111-111111111111";
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => {
      throw error;
    });
    await page.route("https://fixture.example/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<div id='root'></div>",
      });
    });
    await page.goto(
      `https://fixture.example/popup.html?approvalId=${approvalId}#/zkas-send`,
    );
    await page.evaluate(
      ([expectedId, resultTxid]) => {
        (window as typeof window & { __calls: unknown[] }).__calls = [];
        (
          window as typeof window & {
            __message: (method: string, data: object) => Promise<unknown>;
          }
        ).__message = async (method, data) => {
          (window as typeof window & { __calls: unknown[] }).__calls.push({
            method,
            data,
          });
          if (method === "ZKAS_DAPP_PENDING_GET")
            return {
              origin: "https://merchant.example",
              account: {
                walletId: "wallet-1",
                accountIndex: 0,
                network: "mainnet",
                address: "zkas:dummy-address",
              },
              to: "zkas:recipient",
              amountSompi: "1",
              maxFeeSompi: "2",
            };
          if (method === "ZKAS_DAPP_CHECK") return { ok: true };
          throw new Error("Unexpected popup method");
        };
        (
          window as typeof window & {
            __approve: (id: string) => Promise<unknown>;
          }
        ).__approve = async (id) => {
          (window as typeof window & { __calls: unknown[] }).__calls.push({
            method: "APPROVE",
            id,
          });
          if (id !== expectedId) throw new Error("Wrong approval");
          return {
            txid: resultTxid,
            daemonReportedFeeSompi: "1",
            delivered: true,
          };
        };
      },
      [approvalId, txid] as const,
    );
    await page.addScriptTag({ content: script.outputFiles[0].text });
    await page
      .getByRole("button", { name: "Approve and send" })
      .click({ timeout: 5_000 });
    await expect(page.getByText(txid)).toBeVisible({ timeout: 5_000 });
    const calls = await page.evaluate(
      () => (window as typeof window & { __calls: unknown[] }).__calls,
    );
    expect(calls).toEqual([
      { method: "ZKAS_DAPP_PENDING_GET", data: { approvalId } },
      { method: "ZKAS_DAPP_CHECK", data: { approvalId } },
      { method: "APPROVE", id: approvalId },
    ]);
    expect(JSON.stringify(calls)).not.toContain(fvk);
    expect(JSON.stringify(calls)).not.toContain(bearer);
  } finally {
    await browser.close();
  }
});

function paymentDeadlineClock() {
  const original = globalThis.setTimeout;
  let fire: (() => void) | undefined;
  let count = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    if (delay === 660_000) {
      count += 1;
      fire = callback;
    }
    return original(callback, delay);
  }) as typeof setTimeout;
  return {
    count: () => count,
    fire: () => {
      if (!fire) throw new Error("Payment deadline was not registered");
      fire();
    },
    restore: () => {
      globalThis.setTimeout = original;
    },
  };
}

function holdJournalWrite(
  flow: Awaited<ReturnType<typeof fixture>>,
  status: string,
) {
  const journalKey = "local:zkas-payment-journal-v1";
  const storage = (
    globalThis as typeof globalThis & {
      storage: {
        setItem: (key: string, value: unknown) => Promise<void>;
      };
    }
  ).storage;
  const original = storage.setItem;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  storage.setItem = async (key, value) => {
    if (
      key === journalKey &&
      !held &&
      Object.values(value as object).some(
        (entry) => (entry as { status?: string }).status === status,
      )
    ) {
      held = true;
      entered();
      await blocked;
    }
    await original(key, structuredClone(value));
  };
  return {
    started,
    release,
    record: () => Object.values(flow.values.get(journalKey) ?? {})[0],
    restore: () => {
      storage.setItem = original;
    },
  };
}

const deadlineRequest = {
  method: "ZKAS_PAYMENT_SEND_ORDINARY",
  to: "zkas:recipient",
  amountSompi: "1",
  maxFeeSompi: "2",
  expectedAccount: account,
};

test("a timed-out submitting acknowledgement stops before fetch and later clears its exact reservation", async () => {
  const flow = await fixture();
  const clock = paymentDeadlineClock();
  try {
    await flow.pair();
    const held = holdJournalWrite(flow, "submitting");
    try {
      let result: unknown;
      let settled = false;
      const work = invoke(
        flow.module.zkasPaymentSendOrdinary,
        deadlineRequest,
        ordinarySender,
      ).then((value) => {
        result = value;
        settled = true;
      });
      await held.started;
      clock.fire();
      await expect.poll(() => settled, { timeout: 1_000 }).toBe(true);
      expect(result).toMatchObject({ status: "uncertain" });
      expect(
        flow.calls.some((call) => call.path === "/api/wallet/submit"),
      ).toBe(false);
      held.release();
      await work;
      await expect.poll(() => held.record()).toBeUndefined();
      expect(
        flow.calls.some((call) => call.path === "/api/wallet/submit"),
      ).toBe(false);
      expect(
        await invoke(
          flow.module.zkasPaymentSendOrdinary,
          deadlineRequest,
          ordinarySender,
        ),
      ).toMatchObject({ status: "submitted", txid });
    } finally {
      held.release();
      held.restore();
    }
  } finally {
    clock.restore();
    flow.cleanup();
  }
});

test("the whole payment deadline begins before a stalled admission write", async () => {
  const flow = await fixture();
  const clock = paymentDeadlineClock();
  try {
    await flow.pair();
    const held = holdJournalWrite(flow, "preparing");
    try {
      const work = invoke(
        flow.module.zkasPaymentSendOrdinary,
        deadlineRequest,
        ordinarySender,
      );
      await held.started;
      expect(clock.count()).toBe(1);
      clock.fire();
      expect(await work).toMatchObject({ status: "uncertain" });
      held.release();
      await expect.poll(() => held.record()).toBeUndefined();
      expect(flow.calls).toHaveLength(0);
    } finally {
      held.release();
      held.restore();
    }
  } finally {
    clock.restore();
    flow.cleanup();
  }
});

test("deadline during a held success acknowledgement returns known txid conservatively", async () => {
  const flow = await fixture();
  const clock = paymentDeadlineClock();
  try {
    await flow.pair();
    const held = holdJournalWrite(flow, "success");
    try {
      const work = invoke(
        flow.module.zkasPaymentSendOrdinary,
        deadlineRequest,
        ordinarySender,
      );
      await held.started;
      clock.fire();
      expect(await work).toEqual({ status: "uncertain", txid });
      held.release();
      await expect
        .poll(() => held.record())
        .toMatchObject({ status: "success", txid });
      expect(
        flow.calls.filter((call) => call.path === "/api/wallet/submit"),
      ).toHaveLength(1);
    } finally {
      held.release();
      held.restore();
    }
  } finally {
    clock.restore();
    flow.cleanup();
  }
});

test("a queued account gate cannot begin private payment after its bounded deadline", async () => {
  const flow = await fixture();
  const clock = paymentDeadlineClock();
  let releaseGate!: () => void;
  let gateEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    gateEntered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  try {
    await flow.pair();
    const gate = flow.module.withZKasPaymentAccountGate(async () => {
      gateEntered();
      await blocked;
    });
    await entered;
    const work = invoke(
      flow.module.zkasPaymentSendOrdinary,
      deadlineRequest,
      ordinarySender,
    );
    expect(clock.count()).toBe(1);
    clock.fire();
    expect(await work).toMatchObject({ status: "uncertain" });
    releaseGate();
    await gate;
    await expect
      .poll(
        () =>
          Object.values(flow.values.get("local:zkas-payment-journal-v1") ?? {})
            .length,
      )
      .toBe(0);
    expect(flow.calls).toHaveLength(0);
  } finally {
    releaseGate();
    clock.restore();
    flow.cleanup();
  }
});

test("a stalled pre-fetch cleanup cannot hold the terminal reply past the deadline", async () => {
  const flow = await fixture();
  const clock = paymentDeadlineClock();
  const storage = (
    globalThis as typeof globalThis & {
      storage: {
        setItem: (key: string, value: unknown) => Promise<void>;
      };
    }
  ).storage;
  const original = storage.setItem;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  try {
    await flow.pair();
    flow.setFetch(async (input, init) => {
      const response = await flow.dummyFetch(input, init);
      if (new URL(String(input)).pathname === "/api/wallet/prepare")
        flow.setPermission(false);
      return response;
    });
    storage.setItem = async (key, value) => {
      if (
        key === "local:zkas-payment-journal-v1" &&
        !held &&
        Object.keys(value as object).length === 0
      ) {
        held = true;
        entered();
        await blocked;
      }
      await original(key, structuredClone(value));
    };
    const work = invoke(
      flow.module.zkasPaymentSendOrdinary,
      deadlineRequest,
      ordinarySender,
    );
    await started;
    clock.fire();
    expect(await work).toMatchObject({ status: "uncertain" });
    release();
    await expect
      .poll(
        () =>
          Object.values(flow.values.get("local:zkas-payment-journal-v1") ?? {})
            .length,
      )
      .toBe(0);
    expect(flow.calls.some((call) => call.path === "/api/wallet/submit")).toBe(
      false,
    );
  } finally {
    release();
    storage.setItem = original;
    clock.restore();
    flow.cleanup();
  }
});

test("website delivery delayed beyond the payment deadline never publishes a late page result", async () => {
  const flow = await fixture();
  const clock = paymentDeadlineClock();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await flow.pair();
    const pending = {
      approvalId: "11111111-1111-4111-8111-111111111111",
      pageRequestId: "page-1",
      tabId: 7,
      frameId: 0,
      origin: "https://merchant.example",
      account,
      to: "zkas:recipient",
      amountSompi: "1",
      maxFeeSompi: "2",
      createdAt: Date.now(),
      windowId: 42,
    };
    await flow.module.zkasConnectionStore.add(pending.origin, account);
    await flow.module.zkasDappPendingStore.acquire(pending);
    (
      globalThis as typeof globalThis & {
        browser: {
          alarms: { clear: () => Promise<void> };
        };
      }
    ).browser.alarms.clear = async () => {
      entered();
      await blocked;
    };
    const work = invoke(
      flow.module.zkasPaymentSendWebsite,
      { method: "ZKAS_PAYMENT_SEND_WEBSITE", approvalId: pending.approvalId },
      websiteSender,
    );
    await started;
    clock.fire();
    expect(await work).toEqual({ status: "uncertain", txid });
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(flow.delivered).toHaveLength(0);
  } finally {
    release();
    clock.restore();
    flow.cleanup();
  }
});

test("late proof response and late signature cannot submit after the shared deadline", async () => {
  for (const stage of ["proof", "sign"] as const) {
    const flow = await fixture();
    const clock = paymentDeadlineClock();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await flow.pair();
      if (stage === "proof") {
        flow.setFetch(async (input, init) => {
          if (new URL(String(input)).pathname === "/api/wallet/prepare") {
            entered();
            await blocked;
          }
          return flow.dummyFetch(input, init);
        });
      } else {
        (
          globalThis as typeof globalThis & {
            __privateDeps: {
              sign: () => Promise<{ index: number; sig: string }[]>;
            };
          }
        ).__privateDeps.sign = async () => {
          entered();
          await blocked;
          return [{ index: 0, sig: "e".repeat(128) }];
        };
      }
      const work = invoke(
        flow.module.zkasPaymentSendOrdinary,
        deadlineRequest,
        ordinarySender,
      );
      await started;
      clock.fire();
      expect(await work).toMatchObject({ status: "uncertain" });
      release();
      await expect
        .poll(
          () =>
            Object.values(
              flow.values.get("local:zkas-payment-journal-v1") ?? {},
            ).length,
        )
        .toBe(0);
      expect(
        flow.calls.some((call) => call.path === "/api/wallet/submit"),
      ).toBe(false);
    } finally {
      release();
      clock.restore();
      flow.cleanup();
    }
  }
});

test("elapsed monotonic deadline stops late admission and proof even before the timer callback runs", async () => {
  for (const stage of ["admission", "proof"] as const) {
    const flow = await fixture();
    const priorNow = Object.getOwnPropertyDescriptor(performance, "now");
    let tick = performance.now();
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => tick,
    });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: ReturnType<typeof holdJournalWrite> | undefined;
    try {
      await flow.pair();
      if (stage === "admission") {
        held = holdJournalWrite(flow, "preparing");
      } else {
        flow.setFetch(async (input, init) => {
          if (new URL(String(input)).pathname === "/api/wallet/prepare") {
            entered();
            await blocked;
          }
          return flow.dummyFetch(input, init);
        });
      }
      const work = invoke(
        flow.module.zkasPaymentSendOrdinary,
        deadlineRequest,
        ordinarySender,
      );
      await (held?.started ?? started);
      tick += 660_001;
      held?.release();
      release();
      expect(await work).toMatchObject({ status: "uncertain" });
      if (priorNow) Object.defineProperty(performance, "now", priorNow);
      else delete (performance as unknown as { now?: () => number }).now;
      expect(
        flow.calls.some((call) => call.path === "/api/wallet/submit"),
      ).toBe(false);
      await expect
        .poll(
          () =>
            Object.values(
              flow.values.get("local:zkas-payment-journal-v1") ?? {},
            ).length,
        )
        .toBe(0);
    } finally {
      held?.release();
      held?.restore();
      release();
      if (priorNow) Object.defineProperty(performance, "now", priorNow);
      else delete (performance as unknown as { now?: () => number }).now;
      flow.cleanup();
    }
  }
});

for (const expireAtEntry of [false, true]) {
  test(`an initial ${expireAtEntry ? "expired" : "current"} deadline has no unhandled rejection`, async () => {
    const flow = await fixture();
    await flow.pair();
    const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
    const realNow = performance.now.bind(performance);
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.prependListener("unhandledRejection", listener);
    let reads = 0;
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => {
        if (!new Error().stack?.includes("PaymentDeadline")) return realNow();
        reads += 1;
        return expireAtEntry && reads > 1 ? 660_001 : 0;
      },
    });
    try {
      const result = await invoke(
        flow.module.zkasPaymentSendOrdinary,
        deadlineRequest,
        ordinarySender,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(result).toMatchObject({
        status: expireAtEntry ? "uncertain" : "submitted",
      });
      if (expireAtEntry) {
        expect(flow.calls).toHaveLength(0);
        expect(
          Object.keys(flow.values.get("local:zkas-payment-journal-v1") ?? {}),
        ).toHaveLength(0);
      }
      expect(unhandled).toEqual([]);
    } finally {
      if (descriptor) Object.defineProperty(performance, "now", descriptor);
      else delete (performance as unknown as { now?: () => number }).now;
      process.removeListener("unhandledRejection", listener);
      flow.cleanup();
    }
  });
}
