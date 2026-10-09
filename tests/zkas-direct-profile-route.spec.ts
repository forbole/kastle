import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const origin = "https://messages.example";
const account = {
  walletId: "wallet-1",
  accountIndex: 0,
  network: "mainnet",
  address: "zkas:" + "a".repeat(80),
};
const profile = {
  protocolId: "matjam-onchain-v3",
  accountAddress: account.address,
  peerId: "b".repeat(32),
  publicCard: "cd".repeat(184),
};

type Dependencies = {
  account: typeof account;
  profile: typeof profile;
  connected: boolean;
  generation: bigint;
  session: number;
  originValid: boolean;
  waitProfile?: Promise<void>;
  waitFinalConnection?: Promise<void>;
  finalConnectionEntered?: () => void;
  waitFinalSettings?: Promise<void>;
  finalSettingsEntered?: () => void;
  pendingPrivateWork?: boolean;
  connectionReads?: number;
  selectedWalletId?: string;
  selectedAccountIndex?: number;
  activeChain?: "zkas" | "kaspa";
  enabled?: boolean;
};
declare global {
  var __directRouteDeps: Dependencies;
}

async function handlers() {
  const source = readFileSync(
    resolve("api/background/handlers/zkas/direct-profile.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("const protocolId"));
  const prelude = `
    const ApiUtils = { createApiResponse: (id, response) => ({ id, response }) };
    const WALLET_SETTINGS = 'local:wallet-settings';
    const SETTINGS_KEY = 'local:settings';
    const ZKAS_EXPERIMENTAL_KEY = 'local:zkas-experimental-enabled';
    const ZKAS_MAINNET_GENESIS = 'b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f';
    const locks = new Map();
    const withLock = (name, operation) => {
      const prior = locks.get(name) ?? Promise.resolve();
      const result = prior.then(operation);
      locks.set(name, result.then(() => undefined, () => undefined));
      return result;
    };
    const withWalletSettingsLock = operation => withLock('wallet', operation);
    const withSettingsLock = operation => withLock('settings', operation);
    const isZKasActive = (settings, enabled) => settings?.preview === true &&
      enabled !== false && settings.activeChain === 'zkas' && settings.networkId === 'mainnet';
    globalThis.__directRouteWriter = {
      wallet: operation => withWalletSettingsLock(operation),
      settings: operation => withSettingsLock(operation),
    };
    const storage = { getItem: async key => {
      if (key === SETTINGS_KEY) return {activeChain:globalThis.__directRouteDeps.activeChain, preview:true, networkId:'mainnet',
        zkasDaemonUrls:{mainnet:'https://wallet.example.test'}, zkasHistoryIndexUrls:{mainnet:'https://index.example.test'}};
      if (key === ZKAS_EXPERIMENTAL_KEY) return globalThis.__directRouteDeps.enabled;
      if (key !== WALLET_SETTINGS) throw Error('unexpected storage key');
      if (globalThis.__directRouteDeps.waitFinalSettings) {
        globalThis.__directRouteDeps.finalSettingsEntered?.();
        await globalThis.__directRouteDeps.waitFinalSettings;
      }
      return { selectedWalletId: globalThis.__directRouteDeps.selectedWalletId, selectedAccountIndex: globalThis.__directRouteDeps.selectedAccountIndex, wallets: [{ id: 'wallet-1', accounts: [{ index: 0, address: globalThis.__directRouteDeps.account.address }] }] };
    } };
    const ExtensionService = { getInstance: () => ({ getKeyring: () => ({ isUnlocked: () => true, getSessionVersion: () => globalThis.__directRouteDeps.session, isPrivateWalletWorkPending: () => !!globalThis.__directRouteDeps.pendingPrivateWork }) }) };
    const browser = { runtime: { id: 'extension' } };
    const isTrustedZKasPageRequest = (origin, sender, extensionId) => globalThis.__directRouteDeps.originValid && sender.id === extensionId && new URL(sender.url).origin === origin;
    const zkasConnectionStore = { getGeneration: () => globalThis.__directRouteDeps.generation, list: async () => {
      globalThis.__directRouteDeps.connectionReads = (globalThis.__directRouteDeps.connectionReads ?? 0) + 1;
      if (globalThis.__directRouteDeps.connectionReads === 2 && globalThis.__directRouteDeps.waitFinalConnection) {
        globalThis.__directRouteDeps.finalConnectionEntered?.();
        await globalThis.__directRouteDeps.waitFinalConnection;
      }
      return globalThis.__directRouteDeps.connected ? [${JSON.stringify(origin)}] : [];
    } };
    const hasZKasConnection = (connections, candidate) => connections.includes(candidate);
    const zkasKeyService = {
      publicAccount: async () => ({ ...globalThis.__directRouteDeps.account }),
      checkSelection: async () => {},
      publicMessagingProfile: async () => { if (globalThis.__directRouteDeps.waitProfile) await globalThis.__directRouteDeps.waitProfile; return { ...globalThis.__directRouteDeps.profile }; },
      openPrivateMessagingSession: async () => ({ address: globalThis.__directRouteDeps.account.address, publicCard: () => Uint8Array.from(globalThis.__directRouteDeps.profile.publicCard.match(/.{2}/g), value => Number.parseInt(value, 16)), assertCurrent: async () => { if (globalThis.__directRouteDeps.pendingPrivateWork) throw Error('account changed'); }, close: () => {} }),
    };
    const directReceiveRegistry = {
      read: async (_, selected) => ({
        view: { protocolId:'matjam-onchain-v3', accountAddress:selected.accountAddress,
          history:'session-from-birth', invitations:[], contacts:[], threads:[] },
        assertCurrent: async () => { if (globalThis.__directRouteDeps.pendingPrivateWork) throw Error('account changed'); },
        assertImmediate: () => { if (globalThis.__directRouteDeps.pendingPrivateWork) throw Error('account changed'); },
      }),
      close: () => {},
    };
    const sameZKasSelection = (a, b) => a.walletId === b.walletId && a.accountIndex === b.accountIndex && a.network === b.network;
  `;
  const result = await transform(`${prelude}\n${body}`, {
    loader: "ts",
    format: "iife",
    globalName: "DirectRoute",
    target: "es2022",
  });
  return new Function(`${result.code}\nreturn DirectRoute;`)() as {
    zkasDirectProfileHandler: (
      tab: number,
      message: unknown,
      reply: (value: unknown) => void,
      sender: unknown,
    ) => Promise<void>;
    zkasDirectViewHandler: (
      tab: number,
      message: unknown,
      reply: (value: unknown) => void,
      sender: unknown,
    ) => Promise<void>;
  };
}

async function background() {
  const source = readFileSync(
    resolve("api/background/background-service.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("export class BackgroundService"));
  const actions = [
    "CONNECT",
    "GET_ACCOUNT",
    "SIGN_AND_BROADCAST_TX",
    "SIGN_TX",
    "GET_NETWORK",
    "ETHEREUM_REQUEST",
    "SIGN_MESSAGE",
    "SWITCH_NETWORK",
    "COMMIT_REVEAL",
    "SEND_SOMPI",
    "GET_BALANCE",
    "GET_UTXO_ENTRIES",
    "BUILD_TRANSACTION",
    "GET_VERSION",
    "COMPOUND_UTXOS",
    "ZKAS_CONNECT",
    "ZKAS_GET_ACCOUNT",
    "ZKAS_GET_BALANCE",
    "ZKAS_SEND",
    "ZKAS_HISTORY_GRANT",
    "MJ3_REQUEST_PROFILE",
    "MJ3_GET_DIRECT_VIEW",
  ];
  const otherHandlers = [
    "connectHandler",
    "getAccountHandler",
    "signAndBroadcastTxHandler",
    "signTxHandler",
    "getNetwork",
    "ethereumRequestHandler",
    "signMessageHandler",
    "switchNetworkHandler",
    "commitRevealHandler",
    "sendSompiHandler",
    "getBalanceHandler",
    "getUtxoEntriesHandler",
    "buildTransactionHandler",
    "getVersionHandler",
    "compoundUtxosHandler",
    "zkasConnectHandler",
    "zkasGetAccountHandler",
    "zkasGetBalanceHandler",
    "zkasSendHandler",
    "zkasHistoryGrantHandler",
  ];
  const prelude = `
    const Action = Object.fromEntries(${JSON.stringify(actions)}.map(value => [value, value]));
    const ApiRequestWithHostSchema = { safeParse: value => ({success: true, data: value}), parse: value => value };
    const ApiResponseSchema = { parse: value => value };
    const isTrustedZKasPageRequest = (origin, sender, extensionId) => globalThis.__directRouteDeps.originValid && sender.id === extensionId && new URL(sender.url).origin === origin;
    const listenForZKasDappPaymentClosure = () => {};
    const listenForHistoryGrantClosure = () => {};
    const browser = { runtime: { id: 'extension', onMessage: { addListener: callback => { globalThis.__backgroundListener = callback } } } };
    const ${otherHandlers.join(" = () => {}, ")} = () => {};
    const zkasDirectProfileHandler = async (_tab, _message, response) => { globalThis.__directRouteCalls++; response({ok: true}); };
    const zkasDirectViewHandler = zkasDirectProfileHandler;
  `;
  const result = await transform(`${prelude}\n${body}`, {
    loader: "ts",
    format: "iife",
    globalName: "BackgroundRoute",
    target: "es2022",
  });
  return new Function(
    `${result.code}\nreturn BackgroundRoute.BackgroundService;`,
  )() as new () => { listen(): void };
}

async function injectedRequest() {
  const source = readFileSync(resolve("api/browser.ts"), "utf8");
  const body = source.slice(source.indexOf("export class KastleBrowserAPI"));
  const prelude = `
    const Action = new Proxy({}, { get: (_object, key) => String(key) });
    const uuid = () => 'request-1';
    const createApiRequest = (action, id, payload) => ({ action, id, payload });
    const EthereumBrowserAPI = class {};
    const window = { postMessage: request => { globalThis.__injectedRequests.push(request) } };
  `;
  const result = await transform(`${prelude}\n${body}`, {
    loader: "ts",
    format: "iife",
    globalName: "InjectedRoute",
    target: "es2022",
  });
  const Browser = new Function(
    `${result.code}\nreturn InjectedRoute.KastleBrowserAPI;`,
  )() as new () => {
    request(method: string, args?: unknown): Promise<unknown>;
    receiveMessageWithTimeout(id: string): Promise<unknown>;
  };
  const api = Object.create(Browser.prototype) as InstanceType<typeof Browser>;
  api.receiveMessageWithTimeout = async () => true;
  return api;
}

function setup() {
  globalThis.__directRouteDeps = {
    account: { ...account },
    profile: { ...profile },
    connected: true,
    generation: 1n,
    session: 1,
    originValid: true,
    selectedWalletId: account.walletId,
    selectedAccountIndex: account.accountIndex,
    activeChain: "zkas",
    enabled: true,
  };
  const message = { id: "request-1", origin, payload: undefined };
  const sender = { id: "extension", url: `${origin}/chat`, tab: { id: 7 } };
  return { message, sender };
}

test("connected profile returns only public card fields and view uses the private session scope", async () => {
  const { message, sender } = setup();
  const route = await handlers();
  let result: unknown;
  await route.zkasDirectProfileHandler(
    7,
    message,
    (value) => {
      result = value;
    },
    sender,
  );
  expect(result).toEqual({ id: "request-1", response: profile });
  await route.zkasDirectViewHandler(
    7,
    message,
    (value) => {
      result = value;
    },
    sender,
  );
  expect(result).toEqual({
    id: "request-1",
    response: {
      protocolId: "matjam-onchain-v3",
      accountAddress: account.address,
      history: "session-from-birth",
      invitations: [],
      contacts: [],
      threads: [],
    },
  });
});

test("spoofed sender, unconnected origin and extra parameters fail before profile derivation", async () => {
  const { message, sender } = setup();
  const route = await handlers();
  globalThis.__directRouteDeps.originValid = false;
  await expect(
    route.zkasDirectProfileHandler(7, message, () => {}, sender),
  ).rejects.toThrow();
  globalThis.__directRouteDeps.originValid = true;
  globalThis.__directRouteDeps.connected = false;
  await expect(
    route.zkasDirectProfileHandler(7, message, () => {}, sender),
  ).rejects.toThrow();
  globalThis.__directRouteDeps.connected = true;
  await expect(
    route.zkasDirectViewHandler(
      7,
      { ...message, payload: { extra: true } },
      () => {},
      sender,
    ),
  ).rejects.toThrow();
});

test("revocation or account switch while profile awaits cannot deliver an old card", async () => {
  const { message, sender } = setup();
  const route = await handlers();
  let release!: () => void;
  globalThis.__directRouteDeps.waitProfile = new Promise((resolve) => {
    release = resolve;
  });
  const sent: unknown[] = [];
  const pending = route.zkasDirectProfileHandler(
    7,
    message,
    (value) => sent.push(value),
    sender,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  globalThis.__directRouteDeps.generation += 1n;
  globalThis.__directRouteDeps.connected = false;
  release();
  await expect(pending).rejects.toThrow();
  expect(sent).toHaveLength(0);
  let releaseSecond!: () => void;
  globalThis.__directRouteDeps.waitProfile = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  globalThis.__directRouteDeps.connected = true;
  const second = route.zkasDirectProfileHandler(
    7,
    message,
    (value) => sent.push(value),
    sender,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  globalThis.__directRouteDeps.account = {
    ...account,
    address: "zkas:" + "f".repeat(80),
  };
  releaseSecond();
  await expect(second).rejects.toThrow();
  expect(sent).toHaveLength(0);
});

test("a wallet switch or queued lock during the final connection read cannot return an old profile", async () => {
  const route = await handlers();
  for (const change of ["selection", "lock"] as const) {
    const { message, sender } = setup();
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    globalThis.__directRouteDeps.finalConnectionEntered = entered;
    globalThis.__directRouteDeps.waitFinalConnection = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );
    const sent: unknown[] = [];
    const request = route.zkasDirectProfileHandler(
      7,
      message,
      (value) => sent.push(value),
      sender,
    );
    await reached;
    if (change === "selection")
      globalThis.__directRouteDeps.selectedWalletId = "wallet-2";
    else globalThis.__directRouteDeps.pendingPrivateWork = true;
    release();
    await expect(request).rejects.toThrow();
    expect(sent).toHaveLength(0);
  }
});

test("a selection change during the last wallet-settings read cannot return an old profile", async () => {
  const route = await handlers();
  for (const change of ["wallet", "account"] as const) {
    const { message, sender } = setup();
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    globalThis.__directRouteDeps.finalSettingsEntered = entered;
    globalThis.__directRouteDeps.waitFinalSettings = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );
    const sent: unknown[] = [];
    const request = route.zkasDirectViewHandler(
      7,
      message,
      (value) => sent.push(value),
      sender,
    );
    await reached;
    if (change === "wallet")
      globalThis.__directRouteDeps.selectedWalletId = "wallet-2";
    else globalThis.__directRouteDeps.selectedAccountIndex = 1;
    release();
    await expect(request).rejects.toThrow();
    expect(sent).toHaveLength(0);
  }
});

test("a committed wallet switch or network switch wins before final profile delivery", async () => {
  const route = await handlers();
  for (const kind of ["wallet", "network"] as const) {
    const { message, sender } = setup();
    const writer = (
      globalThis as unknown as {
        __directRouteWriter: {
          wallet(operation: () => Promise<void>): Promise<void>;
          settings(operation: () => Promise<void>): Promise<void>;
        };
      }
    ).__directRouteWriter;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const mutation = writer[kind === "wallet" ? "wallet" : "settings"](
      async () => {
        entered();
        await held;
        if (kind === "wallet")
          globalThis.__directRouteDeps.selectedWalletId = "wallet-2";
        else globalThis.__directRouteDeps.activeChain = "kaspa";
      },
    );
    await started;
    const sent: unknown[] = [];
    const request = route.zkasDirectProfileHandler(
      7,
      message,
      (value) => sent.push(value),
      sender,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await mutation;
    await expect(request).rejects.toThrow();
    expect(sent).toHaveLength(0);
  }
});

test("the actual background action gate rejects a spoofed page sender before dispatch", async () => {
  setup();
  const Service = await background();
  const listenerState = globalThis as unknown as {
    __backgroundListener: (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void,
    ) => boolean;
    __directRouteCalls: number;
  };
  listenerState.__directRouteCalls = 0;
  new Service().listen();
  const replies: unknown[] = [];
  const request = {
    id: "request-1",
    action: "MJ3_REQUEST_PROFILE",
    origin,
    host: "messages.example",
  };
  listenerState.__backgroundListener(
    request,
    { id: "foreign", url: `${origin}/chat`, tab: { id: 7 } },
    (value) => replies.push(value),
  );
  expect(replies).toHaveLength(1);
  expect(listenerState.__directRouteCalls).toBe(0);
  expect(JSON.stringify(replies[0])).toMatch(/origin did not match/);
  listenerState.__backgroundListener(
    request,
    { id: "extension", url: `${origin}/chat`, tab: { id: 7 } },
    (value) => replies.push(value),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(listenerState.__directRouteCalls).toBe(1);
});

test("injected provider maps only the two no-argument messaging methods", async () => {
  const calls: unknown[] = [];
  (
    globalThis as unknown as { __injectedRequests: unknown[] }
  ).__injectedRequests = calls;
  const provider = await injectedRequest();
  await provider.request("mj3:request_profile");
  await provider.request("mj3:get_direct_view");
  expect(calls).toEqual([
    { action: "MJ3_REQUEST_PROFILE", id: "request-1", payload: undefined },
    { action: "MJ3_GET_DIRECT_VIEW", id: "request-1", payload: undefined },
  ]);
  await expect(
    provider.request("mj3:request_profile", { extra: true }),
  ).rejects.toThrow(/no arguments/);
  await expect(provider.request("mj3:get_direct_view", {})).rejects.toThrow(
    /no arguments/,
  );
  expect(calls).toHaveLength(2);
});
