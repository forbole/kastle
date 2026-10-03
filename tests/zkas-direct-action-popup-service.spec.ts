import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const id = "11111111-2222-4333-8444-555555555555";
const actionId = "aa".repeat(16);
const facts = {
  kind: "text",
  actionId,
  text: "Full message to approve",
  decision: null,
  referenceActionId: "bb".repeat(16),
  ownerPeerId: "cc".repeat(16),
  recipientPeerId: "dd".repeat(16),
  recipientCardHex: "ee".repeat(184),
  accountAddress: "zkas:" + "a".repeat(79),
  daemonOrigin: "https://wallet.example",
  outputs: [
    { role: "peer", recipient: "zkas:" + "b".repeat(79), amountSompi: "1" },
    { role: "cache", recipient: "zkas:" + "c".repeat(79), amountSompi: "1" },
    { role: "archive", recipient: "zkas:" + "d".repeat(79), amountSompi: "1" },
    {
      role: "collector",
      recipient: "zkas:" + "e".repeat(79),
      amountSompi: "10000000",
    },
  ],
  explicitTotalSompi: "10000003",
  maxNetworkFeeSompi: "5000000",
  maximumTotalSompi: "15000003",
};

async function service() {
  const source = readFileSync(
    resolve("lib/service/handlers/zkas-direct-action.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("const UUID ="));
  const prelude = `
    const directActionPopupStore = {
      get: id => globalThis.__popupCurrent?.approvalId === id ? globalThis.__popupCurrent : null,
      claim: id => {const current=directActionPopupStore.get(id); if(!current || current.state!=="awaiting") throw Error("claimed"); current.state="approving"; return {pending:current,assertCurrent:()=>{if(globalThis.__popupCurrent!==current) throw Error("changed");}};},
      finish: id => {const current=directActionPopupStore.get(id);globalThis.__popupCurrent=null;return current;},
    };
    const isDirectActionPopupSender = () => globalThis.__popupTrusted;
    const directActionFactory = {
      reviewFacts: (id,binding) => {binding.assertCurrent();globalThis.__popupCalls.push("facts");return globalThis.__popupFacts;},
      acceptApproval: async (id,binding) => {binding.assertCurrent();globalThis.__popupCalls.push("accept");globalThis.__factoryPhase="approving";if(globalThis.__acceptThrows) throw Error("approval uncertain");return {actionId:${JSON.stringify(actionId)},state:"pending",preparation:{daemonOrigin:"https://wallet.example",logicalId:"aa".repeat(32),capability:"bb".repeat(32),expiresAtUnix:1790000000}};},
      rejectApproval: () => {globalThis.__popupCalls.push("reject");if(globalThis.__rejectThrows) throw Error("review missing");return {actionId:${JSON.stringify(actionId)},state:globalThis.__factoryPhase==="reviewing"?"failed":"unknown"};},
    };
    const deliverDirectActionResult = async (_pending,result) => {globalThis.__popupCalls.push(["deliver",result.state]);return true;};
    const publicDirectActionReply = (value,id) => {if(value.actionId!==id) throw Error("changed");return value;};
    const browser = {runtime:{id:"extension"},alarms:{clear:async()=>{}},tabs:{sendMessage:async (_tab,message)=>globalThis.__frameAck?({nonce:message.nonce,origin:message.origin}):({nonce:"00".repeat(32),origin:message.origin})}};
    const ZKasHistoryChallengeSchema = {parse:value=>value};
    const ZKasHistoryChallengeAckSchema = {safeParse:value=>({success:true,data:value})};
  `;
  const result = await transform(prelude + body, {
    loader: "ts",
    format: "iife",
    globalName: "DirectPopupService",
    target: "es2022",
  });
  return new Function(result.code + "\nreturn DirectPopupService;")() as {
    zkasDirectActionPendingGet: (
      message: unknown,
      respond: (value: unknown) => void,
      sender: unknown,
    ) => Promise<void>;
    zkasDirectActionComplete: (
      message: unknown,
      respond: (value: unknown) => void,
      sender: unknown,
    ) => Promise<void>;
  };
}

function setup() {
  Object.assign(globalThis, {
    __popupTrusted: true,
    __popupCalls: [],
    __popupFacts: facts,
    __factoryPhase: "reviewing",
    __frameAck: true,
    __acceptThrows: false,
    __rejectThrows: false,
    __popupCurrent: {
      approvalId: id,
      actionId,
      origin: "https://messages.example",
      tabId: 7,
      frameId: 3,
      pageRequestId: "page-1",
      state: "awaiting",
    },
  });
}

test("only exact bound popup may read full review facts", async () => {
  setup();
  const serviceHandlers = await service();
  let response: unknown;
  const sender = { id: "extension", frameId: 0, tab: { id: 11, windowId: 12 } };
  await serviceHandlers.zkasDirectActionPendingGet(
    { approvalId: id },
    (value) => {
      response = value;
    },
    sender,
  );
  expect(response).toEqual({ origin: "https://messages.example", facts });
  Object.assign(globalThis, { __popupTrusted: false });
  await expect(
    serviceHandlers.zkasDirectActionPendingGet(
      { approvalId: id },
      () => {},
      sender,
    ),
  ).rejects.toThrow();
  expect(
    (globalThis as unknown as { __popupCalls: unknown[] }).__popupCalls,
  ).toEqual(["facts"]);
});

test("failed frame challenge cancels only an unapproved review", async () => {
  setup();
  Object.assign(globalThis, { __frameAck: false });
  const serviceHandlers = await service();
  const sender = { id: "extension", frameId: 0, tab: { id: 11, windowId: 12 } };
  let response: unknown;
  await serviceHandlers.zkasDirectActionComplete(
    { approvalId: id, decision: "approve" },
    (value) => {
      response = value;
    },
    sender,
  );
  expect(response).toEqual({ state: "failed", delivered: false });
  expect(
    (globalThis as unknown as { __popupCalls: unknown[] }).__popupCalls,
  ).toEqual(["reject", ["deliver", "failed"]]);
});

test("approval uncertainty returns the original action ID as unknown", async () => {
  setup();
  Object.assign(globalThis, { __acceptThrows: true });
  const serviceHandlers = await service();
  const sender = { id: "extension", frameId: 0, tab: { id: 11, windowId: 12 } };
  let response: unknown;
  await serviceHandlers.zkasDirectActionComplete(
    { approvalId: id, decision: "approve" },
    (value) => {
      response = value;
    },
    sender,
  );
  expect(response).toEqual({ state: "unknown", delivered: false });
  expect(
    (globalThis as unknown as { __popupCalls: unknown[] }).__popupCalls,
  ).toEqual(["accept", "reject", ["deliver", "unknown"]]);
});

test("missing private review on denial still returns the original ID as unknown", async () => {
  setup();
  Object.assign(globalThis, { __rejectThrows: true });
  const serviceHandlers = await service();
  const sender = { id: "extension", frameId: 0, tab: { id: 11, windowId: 12 } };
  let response: unknown;
  await serviceHandlers.zkasDirectActionComplete(
    { approvalId: id, decision: "deny" },
    (value) => {
      response = value;
    },
    sender,
  );
  expect(response).toEqual({ state: "unknown" });
  expect(
    (globalThis as unknown as { __popupCalls: unknown[] }).__popupCalls,
  ).toEqual(["reject", ["deliver", "unknown"]]);
});

test("human denial sends only factory-confirmed failed receipt; approval sends descriptor", async () => {
  setup();
  const serviceHandlers = await service();
  const sender = { id: "extension", frameId: 0, tab: { id: 11, windowId: 12 } };
  let response: unknown;
  await serviceHandlers.zkasDirectActionComplete(
    { approvalId: id, decision: "deny" },
    (value) => {
      response = value;
    },
    sender,
  );
  expect(response).toEqual({ state: "failed" });
  expect(
    (globalThis as unknown as { __popupCalls: unknown[] }).__popupCalls,
  ).toEqual(["reject", ["deliver", "failed"]]);
  setup();
  response = undefined;
  await serviceHandlers.zkasDirectActionComplete(
    { approvalId: id, decision: "approve" },
    (value) => {
      response = value;
    },
    sender,
  );
  expect(response).toEqual({ state: "pending", delivered: true });
  expect(
    (globalThis as unknown as { __popupCalls: unknown[] }).__popupCalls,
  ).toEqual(["accept", ["deliver", "pending"]]);
});
