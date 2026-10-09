import { expect, test } from "@playwright/test";
import {
  DirectActionPopupStore,
  isDirectActionPopupSender,
} from "../lib/zkas/direct-action-popup";

const id = "11111111-2222-4333-8444-555555555555";
const url = `chrome-extension://test/popup.html?approvalId=${id}#/zkas-direct-action`;
const pending = {
  approvalId: id,
  actionId: "aa".repeat(16),
  pageRequestId: "page-1",
  origin: "https://messages.example",
  tabId: 7,
  frameId: 3,
  createdAt: 1_000,
};
const sender = {
  id: "test",
  url,
  origin: "chrome-extension://test",
  frameId: 0,
  tab: { id: 11, windowId: 12 },
};

test("only exact extension popup tab and window may claim approval", async () => {
  const store = new DirectActionPopupStore(() => 1_001);
  await store.acquire(pending);
  await store.bindPopup(id, 12, 11, url);
  const current = store.get(id);
  expect(current).not.toBeNull();
  expect(isDirectActionPopupSender(current!, sender, "test")).toBe(true);
  for (const changed of [
    { ...sender, id: "foreign" },
    { ...sender, frameId: 1 },
    { ...sender, tab: { id: 13, windowId: 12 } },
    { ...sender, tab: { id: 11, windowId: 14 } },
    { ...sender, url: url + "&approved=true" },
    { ...sender, origin: "https://messages.example" },
  ])
    expect(isDirectActionPopupSender(current!, changed, "test")).toBe(false);
  const claimed = store.claim(id);
  expect(claimed.assertCurrent).toBeInstanceOf(Function);
  expect(() => store.claim(id)).toThrow();
  store.invalidateByWindow(12);
  expect(() => claimed.assertCurrent()).toThrow();
});

test("single ephemeral approval expires and closure clears its page binding", async () => {
  let now = 1_000;
  const store = new DirectActionPopupStore(() => now);
  await store.acquire(pending);
  await expect(
    store.acquire({
      ...pending,
      approvalId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    }),
  ).rejects.toThrow();
  await store.bindPopup(id, 12, 11, url);
  expect(store.invalidateByWindow(12)?.pageRequestId).toBe("page-1");
  expect(store.get(id)).toBeNull();
  await store.acquire(pending);
  now += 180_001;
  expect(store.get(id)).toBeNull();
});
