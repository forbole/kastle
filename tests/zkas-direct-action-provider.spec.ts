import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Request = { action: string; id: string; payload: unknown };
type Response = {
  id: string;
  response: unknown;
  source: string;
  target: string;
  error?: string;
};

async function provider() {
  const source = readFileSync(resolve("api/browser.ts"), "utf8");
  const body = source.slice(source.indexOf("export class KastleBrowserAPI"));
  const prelude = `
    const Action = new Proxy({}, { get: (_object, key) => String(key) });
    const uuid = () => "paid-request";
    const createApiRequest = (action, id, payload) => ({ action, id, payload });
    const EthereumBrowserAPI = class {};
    const ApiResponseSchema = {
      safeParse: value => ({ success: !!value && value.source === "background" && value.target === "browser", data: value }),
      parse: value => value,
    };
    const window = globalThis.__paidWindow;
  `;
  const result = await transform(prelude + body, {
    loader: "ts",
    format: "iife",
    globalName: "PaidProvider",
    target: "es2022",
  });
  return new Function(
    result.code + "\nreturn PaidProvider.KastleBrowserAPI;",
  )() as new () => {
    request(method: string, args?: unknown): Promise<unknown>;
  };
}

test("all paid direct methods route to distinct actions and ignore interim acknowledgment", async () => {
  const posted: Request[] = [];
  const listeners = new Set<
    (event: { origin: string; data: Response }) => void
  >();
  Object.assign(globalThis, {
    __paidWindow: {
      location: { origin: "https://messages.example" },
      postMessage: (request: Request) => posted.push(request),
      addEventListener: (
        _name: string,
        listener: (event: { origin: string; data: Response }) => void,
      ) => listeners.add(listener),
      removeEventListener: (
        _name: string,
        listener: (event: { origin: string; data: Response }) => void,
      ) => listeners.delete(listener),
    },
  });
  const API = await provider();
  const api = Object.create(API.prototype) as InstanceType<typeof API>;
  const cases = [
    ["mj3:invite", "MJ3_INVITE", { publicCard: "aa".repeat(184), note: "hi" }],
    [
      "mj3:decide_invitation",
      "MJ3_DECIDE_INVITATION",
      {
        inviterId: "bb".repeat(16),
        invitationActionId: "cc".repeat(16),
        decision: "accept",
        note: "",
      },
    ],
    [
      "mj3:send_direct_message",
      "MJ3_SEND_DIRECT_MESSAGE",
      { peerId: "bb".repeat(16), text: "hello" },
    ],
  ] as const;
  for (const [method, action, payload] of cases) {
    const result = api.request(method, payload);
    expect(posted.at(-1)).toEqual({ action, id: "paid-request", payload });
    let settled = false;
    result.then(() => {
      settled = true;
    });
    for (const listener of [...listeners])
      listener({
        origin: "https://messages.example",
        data: {
          id: "paid-request",
          source: "background",
          target: "browser",
          response: { pending: true },
        },
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    for (const listener of [...listeners])
      listener({
        origin: "https://messages.example",
        data: {
          id: "paid-request",
          source: "background",
          target: "browser",
          response: { actionId: "dd".repeat(16), state: "pending" },
        },
      });
    await expect(result).resolves.toEqual({
      actionId: "dd".repeat(16),
      state: "pending",
    });
  }
});

test("completion and status carry only original action ID", async () => {
  const posted: Request[] = [];
  Object.assign(globalThis, {
    __paidWindow: { postMessage: (request: Request) => posted.push(request) },
  });
  const API = await provider();
  const api = Object.create(API.prototype) as InstanceType<typeof API> & {
    receiveMessageWithTimeout: () => Promise<unknown>;
  };
  api.receiveMessageWithTimeout = async () => true;
  const payload = { actionId: "aa".repeat(16) };
  await api.request("mj3:complete_direct_action", payload);
  await api.request("mj3:action_status", payload);
  await api.request("mj3:pending_direct_action");
  await api.request("mj3:resume_direct_action", payload);
  await expect(api.request("mj3:pending_direct_action", {})).rejects.toThrow();
  expect(posted.map((item) => [item.action, item.payload])).toEqual([
    ["MJ3_COMPLETE_DIRECT_ACTION", payload],
    ["MJ3_ACTION_STATUS", payload],
    ["MJ3_PENDING_DIRECT_ACTION", undefined],
    ["MJ3_RESUME_DIRECT_ACTION", payload],
  ]);
});
