import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const approvalId = "11111111-2222-4333-8444-555555555555";
const actionId = "aa".repeat(16);
type Handler = (
  tab: number,
  message: unknown,
  respond: (value: unknown) => void,
  sender: unknown,
) => Promise<void>;

async function routes() {
  const source = readFileSync(
    resolve("api/background/handlers/zkas/direct-action.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("function publicActionResult"));
  const prelude = `
    const Action = {MJ3_INVITE: 21,MJ3_DECIDE_INVITATION:22,MJ3_SEND_DIRECT_MESSAGE:23};
    const ApiUtils = { createApiResponse: (id, response) => ({id,response}) };
    const ApiResponseSchema = { parse: value => value };
    const canonicalHistoryDaemonOrigin = value => {if(value!=="https://wallet.example") throw Error("invalid origin");return value;};
    const isTrustedZKasPageRequest = () => globalThis.__directRouteTrusted;
    const parseDirectActionRequest = (kind, payload) => ({kind,...payload});
    const parseDirectActionId = payload => { if (Object.keys(payload).join("|") !== "actionId") throw Error("bad id"); return payload.actionId; };
    const directActionFactory = {
      startReview: async (origin,input) => { globalThis.__directCalls.push(["review",origin,input]); return {approvalId:${JSON.stringify(approvalId)},facts:{actionId:${JSON.stringify(actionId)}}}; },
      complete: async (origin,id) => { globalThis.__directCalls.push(["complete",origin,id]); return {actionId:id,state:"pending"}; },
      status: async (origin,id) => { globalThis.__directCalls.push(["status",origin,id]); return {actionId:id,state:"unknown"}; },
      pending: async origin => { globalThis.__directCalls.push(["pending",origin]); return {actionId:${JSON.stringify(actionId)},state:"unknown"}; },
      resume: async (origin,id) => { globalThis.__directCalls.push(["resume",origin,id]); return {actionId:id,state:"unknown"}; },
      rejectApproval: () => ({actionId:${JSON.stringify(actionId)},state:"failed"}),
    };
    const directActionPopupStore = {
      start: async (operation,page) => {const item=await operation();if(globalThis.__acquireFailure) throw Error("popup binding changed");return {pending:{...page,approvalId:item.approvalId,actionId:item.actionId}};},
      bindPopup: async () => {}, finish: () => null,
      invalidateByWindow: () => null, invalidateByTab: () => null, getByPopupTab: () => null, expire: () => null,
    };
    const DIRECT_ACTION_POPUP_ALARM_PREFIX = "zkas-direct-action-timeout:";
    const DIRECT_ACTION_POPUP_TIMEOUT_MS = 180000;
    const POPUP_WINDOW_HEIGHT = 600, POPUP_WINDOW_WIDTH = 360;
    const browser = {
      runtime:{id:"extension",getURL:path => "chrome-extension://extension"+path},
      windows:{create:async () => {if(globalThis.__popupFailure) throw Error("popup unavailable");return {id:12,tabs:[{id:11,windowId:12}]};},get:async () => ({id:12,tabs:[{id:11,windowId:12}]}),remove:async () => {},onRemoved:{addListener:()=>{}}},
      alarms:{create:async () => {},clear:async () => {},onAlarm:{addListener:()=>{}}},
      tabs:{sendMessage:async () => ({accepted:true,origin:"https://messages.example"}),onRemoved:{addListener:()=>{}},onUpdated:{addListener:()=>{}}},
    };
  `;
  const result = await transform(prelude + body, {
    loader: "ts",
    format: "iife",
    globalName: "DirectRoutes",
    target: "es2022",
  });
  return new Function(result.code + "\nreturn DirectRoutes;")() as {
    zkasDirectActionStartHandler: Handler;
    zkasDirectActionCompleteHandler: Handler;
    zkasDirectActionStatusHandler: Handler;
    zkasDirectActionPendingHandler: Handler;
    zkasDirectActionResumeHandler: Handler;
    publicDirectActionReply: (value: unknown, expectedId: string) => unknown;
  };
}

test("paid request uses trusted page origin and opens bound human review", async () => {
  Object.assign(globalThis, {
    __directRouteTrusted: true,
    __directCalls: [],
    __popupFailure: false,
  });
  const route = await routes();
  let reply: unknown;
  const message = {
    action: 21,
    id: "page-1",
    origin: "https://messages.example",
    payload: { publicCard: "aa".repeat(184), note: "hi" },
  };
  const sender = { id: "extension", frameId: 3, tab: { id: 7 } };
  await route.zkasDirectActionStartHandler(
    7,
    message,
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({ id: "page-1", response: { pending: true } });
  expect(
    (globalThis as unknown as { __directCalls: unknown[] }).__directCalls,
  ).toEqual([
    [
      "review",
      "https://messages.example",
      { kind: "invite", publicCard: "aa".repeat(184), note: "hi" },
    ],
  ]);
  Object.assign(globalThis, { __directRouteTrusted: false, __directCalls: [] });
  await expect(
    route.zkasDirectActionStartHandler(7, message, () => {}, sender),
  ).rejects.toThrow();
  expect(
    (globalThis as unknown as { __directCalls: unknown[] }).__directCalls,
  ).toEqual([]);
});

test("popup creation failure returns the factory-confirmed original failed receipt", async () => {
  Object.assign(globalThis, {
    __directRouteTrusted: true,
    __directCalls: [],
    __popupFailure: true,
  });
  const route = await routes();
  const message = {
    action: 21,
    id: "page-7",
    origin: "https://messages.example",
    payload: { publicCard: "aa".repeat(184), note: "hi" },
  };
  const sender = { id: "extension", frameId: 3, tab: { id: 7 } };
  let reply: unknown;
  await route.zkasDirectActionStartHandler(
    7,
    message,
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({
    id: "page-7",
    response: { actionId, state: "failed" },
  });
});

test("failed popup binding discards its retained factory review with the original ID", async () => {
  Object.assign(globalThis, {
    __directRouteTrusted: true,
    __directCalls: [],
    __popupFailure: false,
    __acquireFailure: true,
  });
  const route = await routes();
  const message = {
    action: 21,
    id: "page-8",
    origin: "https://messages.example",
    payload: { publicCard: "aa".repeat(184), note: "hi" },
  };
  const sender = { id: "extension", frameId: 3, tab: { id: 7 } };
  let reply: unknown;
  await route.zkasDirectActionStartHandler(
    7,
    message,
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({
    id: "page-8",
    response: { actionId, state: "failed" },
  });
});

test("public results reject nested states and disclose only the original descriptor fields", async () => {
  const route = await routes();
  expect(() =>
    route.publicDirectActionReply({ actionId, state: ["finalized"] }, actionId),
  ).toThrow();
  expect(() =>
    route.publicDirectActionReply({ actionId, state: ["pending"] }, actionId),
  ).toThrow();
  expect(() =>
    route.publicDirectActionReply(
      {
        actionId,
        state: "pending",
        preparation: {
          daemonOrigin: "https://user:pass@wallet.example",
          logicalId: "bb".repeat(32),
          capability: "cc".repeat(32),
          expiresAtUnix: 1790000000,
        },
      },
      actionId,
    ),
  ).toThrow();
  expect(() =>
    route.publicDirectActionReply(
      {
        actionId,
        state: "pending",
        preparation: { capability: ["aa".repeat(32)] },
      },
      actionId,
    ),
  ).toThrow();
  expect(
    route.publicDirectActionReply(
      {
        actionId,
        state: "pending",
        internalWalletToken: "private",
        preparation: {
          daemonOrigin: "https://wallet.example",
          logicalId: "bb".repeat(32),
          capability: "cc".repeat(32),
          expiresAtUnix: 1790000000,
          session: "private",
        },
      },
      actionId,
    ),
  ).toEqual({
    actionId,
    state: "pending",
    preparation: {
      daemonOrigin: "https://wallet.example",
      logicalId: "bb".repeat(32),
      capability: "cc".repeat(32),
      expiresAtUnix: 1790000000,
    },
  });
});

test("reload recovery uses only the connected origin and original action ID", async () => {
  Object.assign(globalThis, { __directRouteTrusted: true, __directCalls: [] });
  const route = await routes();
  const sender = { id: "extension", frameId: 3, tab: { id: 7 } };
  let reply: unknown;
  await route.zkasDirectActionPendingHandler(
    7,
    { id: "page-3", origin: "https://messages.example" },
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({
    id: "page-3",
    response: { actionId, state: "unknown" },
  });
  await route.zkasDirectActionResumeHandler(
    7,
    { id: "page-4", origin: "https://messages.example", payload: { actionId } },
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({
    id: "page-4",
    response: { actionId, state: "unknown" },
  });
  expect(
    (globalThis as unknown as { __directCalls: unknown[] }).__directCalls,
  ).toEqual([
    ["pending", "https://messages.example"],
    ["resume", "https://messages.example", actionId],
  ]);
  await expect(
    route.zkasDirectActionPendingHandler(
      7,
      { id: "page-5", origin: "https://messages.example", payload: {} },
      () => {},
      sender,
    ),
  ).rejects.toThrow();
  await expect(
    route.zkasDirectActionResumeHandler(
      7,
      {
        id: "page-6",
        origin: "https://messages.example",
        payload: { actionId, extra: true },
      },
      () => {},
      sender,
    ),
  ).rejects.toThrow();
});

test("completion and status use only original action ID and origin", async () => {
  Object.assign(globalThis, { __directRouteTrusted: true, __directCalls: [] });
  const route = await routes();
  const sender = { id: "extension", frameId: 3, tab: { id: 7 } };
  let reply: unknown;
  const message = {
    id: "page-2",
    origin: "https://messages.example",
    payload: { actionId },
  };
  await route.zkasDirectActionCompleteHandler(
    7,
    message,
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({
    id: "page-2",
    response: { actionId, state: "pending" },
  });
  await route.zkasDirectActionStatusHandler(
    7,
    message,
    (value) => {
      reply = value;
    },
    sender,
  );
  expect(reply).toEqual({
    id: "page-2",
    response: { actionId, state: "unknown" },
  });
  expect(
    (globalThis as unknown as { __directCalls: unknown[] }).__directCalls,
  ).toEqual([
    ["complete", "https://messages.example", actionId],
    ["status", "https://messages.example", actionId],
  ]);
});
