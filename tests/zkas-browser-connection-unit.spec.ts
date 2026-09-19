import { expect, test } from "@playwright/test";
import { addZKasConnection, hasZKasConnection, isAllowedZKasDappOrigin, ZKasConnectionStore, type ZKasConnections } from "@/lib/zkas/connection";
import { isTrustedZKasPageRequest } from "@/api/background/zkas-origin";
import { isTrustedZKasPageMessage } from "@/api/content-script/zkas-page-message";
import { createZKasApprovalSession } from "@/api/background/zkas-approval";

const selected = { walletId: "wallet-a", accountIndex: 1, network: "mainnet" as const };
const origin = "http://localhost:4173";

test("ZKas website grant is exact to origin, wallet, account, and network", () => {
  const connections = addZKasConnection({}, origin, selected);
  expect(hasZKasConnection(connections, origin, selected)).toBe(true);
  expect(hasZKasConnection(connections, "http://localhost:4174", selected)).toBe(false);
  expect(hasZKasConnection(connections, origin, { ...selected, walletId: "wallet-b" })).toBe(false);
  expect(hasZKasConnection(connections, origin, { ...selected, accountIndex: 0 })).toBe(false);
  expect(hasZKasConnection(connections, origin, { ...selected, network: "testnet" })).toBe(false);
  expect(addZKasConnection(connections, origin, selected)).toBe(connections);
});

test("ZKas dApp origins require HTTPS or loopback and no path", () => {
  for (const allowed of [origin, "http://127.0.0.1:4173", "https://wallet.example"]) {
    expect(isAllowedZKasDappOrigin(allowed)).toBe(true);
  }
  for (const denied of ["http://wallet.example", "https://wallet.example/path", "https://user:pass@wallet.example", "null", "file:///"]) {
    expect(isAllowedZKasDappOrigin(denied)).toBe(false);
  }
});

test("background binds ZKas dApp messages to the actual content-script URL", () => {
  const sender = { id: "extension-id", url: `${origin}/index.html` };
  expect(isTrustedZKasPageRequest(origin, sender, "extension-id")).toBe(true);
  expect(isTrustedZKasPageRequest("https://attacker.example", sender, "extension-id")).toBe(false);
  expect(isTrustedZKasPageRequest(origin, { ...sender, id: "other" }, "extension-id")).toBe(false);
  expect(isTrustedZKasPageRequest(origin, { ...sender, url: "malformed" }, "extension-id")).toBe(false);
});

test("content script accepts only messages sent by its own page", () => {
  const pageWindow = { location: { origin } } as Window;
  expect(isTrustedZKasPageMessage(pageWindow, origin, pageWindow)).toBe(true);
  expect(isTrustedZKasPageMessage({} as Window, origin, pageWindow)).toBe(false);
  expect(isTrustedZKasPageMessage(pageWindow, "https://attacker.example", pageWindow)).toBe(false);
});

test("overlapping website grant mutations preserve revocations and order", async () => {
  let saved: ZKasConnections = {
    [origin]: [selected],
    "https://second.example": [selected],
  };
  const store = new ZKasConnectionStore({
    get: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return saved;
    },
    set: async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      saved = value;
    },
  });
  await Promise.all([store.remove(origin), store.remove("https://second.example")]);
  expect(await store.list()).toEqual({});
  await Promise.all([store.add(origin, selected), store.remove(origin)]);
  expect(await store.list()).toEqual({});
  await Promise.all([store.remove(origin), store.add(origin, selected)]);
  expect(hasZKasConnection(await store.list(), origin, selected)).toBe(true);
});

test("two origins reusing one page request ID cannot share an approval channel", () => {
  const first = createZKasApprovalSession("attacker-chosen-id", origin);
  const second = createZKasApprovalSession("attacker-chosen-id", "https://second.example");
  expect(first.pageRequestId).toBe(second.pageRequestId);
  expect(first.approvalId).not.toBe(second.approvalId);
  expect(first.origin).not.toBe(second.origin);
});
