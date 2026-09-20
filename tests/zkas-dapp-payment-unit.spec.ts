import { expect, test } from "@playwright/test";
import {
  isZKasDappPopupSender,
  ZKasDappPendingStore,
  type ZKasDappPending,
} from "@/lib/zkas/dapp-payment";

function request(id: string): ZKasDappPending {
  return {
    approvalId: id,
    pageRequestId: "page-selected-id",
    tabId: 8,
    frameId: 2,
    origin: "https://merchant.example",
    account: {
      walletId: "wallet-1",
      accountIndex: 0,
      network: "mainnet",
      address: "zkas:local",
    },
    to: "zkas:recipient",
    amountSompi: "100000000",
    maxFeeSompi: "10000",
    createdAt: 1_000,
  };
}

test("website payment approval remains single-flight across worker recreation", async () => {
  let saved: ZKasDappPending | null = null;
  const adapter = {
    get: async () => {
      await Promise.resolve();
      return saved;
    },
    set: async (value: ZKasDappPending | null) => {
      await Promise.resolve();
      saved = value;
    },
  };
  const first = new ZKasDappPendingStore(adapter, () => 1_000);
  const accepted = await Promise.allSettled([
    first.acquire(request("approval-a")),
    first.acquire(request("approval-b")),
  ]);
  expect(accepted.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  await first.bindWindow("approval-a", 42);

  const restarted = new ZKasDappPendingStore(adapter, () => 1_000);
  expect((await restarted.get("approval-a"))?.windowId).toBe(42);
  expect(await restarted.takeByWindow(43)).toBeNull();
  expect((await restarted.takeByWindow(42))?.approvalId).toBe("approval-a");
  expect(await restarted.take("approval-a")).toBeNull();
});

test("approval response is bound to its popup window, token, and route", () => {
  const pending = { ...request("approval-a"), windowId: 42 };
  const url =
    "chrome-extension://example/popup.html?approvalId=approval-a#/zkas-send";
  expect(isZKasDappPopupSender(pending, { url, tab: { windowId: 42 } })).toBe(
    true,
  );
  expect(isZKasDappPopupSender(pending, { url, tab: { windowId: 43 } })).toBe(
    false,
  );
  expect(
    isZKasDappPopupSender(pending, {
      url: url.replace("approval-a", "approval-b"),
      tab: { windowId: 42 },
    }),
  ).toBe(false);
  expect(
    isZKasDappPopupSender(pending, {
      url: url.replace("#/zkas-send", "#/dashboard"),
      tab: { windowId: 42 },
    }),
  ).toBe(false);
});
