import { z } from "zod";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import { ZKasClient, probeZKasDaemonBirthday } from "@/lib/zkas/client";
import {
  DaemonBearerStore,
  DAEMON_BEARERS_KEY,
  canonicalDaemonBearerOrigin,
} from "@/lib/zkas/daemon-bearer";
import { zkasKeyService, type ZKasCredentials } from "@/lib/zkas/key-service";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { ExtensionService, type Message } from "../extension-service";
import { Method } from "../methods";

const selection = z
  .object({
    walletId: z.string().min(1).max(128),
    accountIndex: z.number().int().nonnegative().safe(),
    network: z.enum(["mainnet", "testnet"]),
    address: z.string().min(1).max(256).optional(),
  })
  .strict();
const birthdayRequest = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_BIRTHDAY),
    origin: z.string().max(256),
    network: z.enum(["mainnet", "testnet"]),
  })
  .strict();
const registerRequest = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_REGISTER),
    expectedAccount: selection,
    expectedOrigin: z.string().max(256),
    birthday: z.number().int().nonnegative().safe(),
  })
  .strict();
const stateRequest = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_STATE),
    expectedAccount: selection.optional(),
  })
  .strict();
const historyRequest = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_RECENT_HISTORY),
    expectedAccount: selection.optional(),
  })
  .strict();

const routes = new Map([
  ["GET /api/status", 16_384],
  ["POST /api/wallet/watch", 16_384],
  ["GET /api/wallet/balance", 16_384],
  ["GET /api/wallet/history?limit=30", 524_288],
]);
const operationTimeoutMs = 30_000;

function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid ZKas daemon operation");
  return parsed.data;
}

function sourceSnapshot(value: Settings | null): string {
  return JSON.stringify([
    value?.networkId ?? null,
    value?.zkasDaemonUrls ?? null,
  ]);
}

function assertLive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("ZKas daemon operation expired");
}

async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("ZKas daemon operation expired"));
        }, operationTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    controller.abort();
  }
}

async function sourceGuard(origin: string, signal: AbortSignal) {
  const keyring = ExtensionService.getInstance().getKeyring();
  const session = keyring.getSessionVersion();
  const original = await storage.getItem<Settings>(SETTINGS_KEY);
  const source = sourceSnapshot(original);
  const url = new URL(origin);
  const pattern = `${url.protocol}//${url.hostname}/*`;
  const assertCurrent = async () => {
    assertLive(signal);
    if (keyring.getSessionVersion() !== session)
      throw new Error("ZKas daemon context changed");
    const latest = await storage.getItem<Settings>(SETTINGS_KEY);
    assertLive(signal);
    if (
      keyring.getSessionVersion() !== session ||
      sourceSnapshot(latest) !== source
    )
      throw new Error("ZKas daemon context changed");
    const permitted = await browser.permissions.contains({
      origins: [pattern],
    });
    assertLive(signal);
    if (!permitted || keyring.getSessionVersion() !== session)
      throw new Error("ZKas daemon permission changed");
    const afterPermission = await storage.getItem<Settings>(SETTINGS_KEY);
    assertLive(signal);
    if (
      keyring.getSessionVersion() !== session ||
      sourceSnapshot(afterPermission) !== source
    )
      throw new Error("ZKas daemon context changed");
  };
  await assertCurrent();
  return { keyring, original, assertCurrent };
}

async function boundedResponse(
  response: Response,
  maxBytes: number,
  assertCurrent: () => Promise<void>,
  signal: AbortSignal,
): Promise<Response> {
  assertLive(signal);
  if (response.redirected) throw new Error("ZKas daemon redirected");
  const statedLength = response.headers.get("content-length");
  if (
    statedLength &&
    (!/^\d+$/.test(statedLength) || Number(statedLength) > maxBytes)
  )
    throw new Error("ZKas daemon response exceeded its limit");
  if (!response.ok) return new Response(null, { status: response.status });
  if (!response.body) throw new Error("ZKas daemon response is missing");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      await assertCurrent();
      assertLive(signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes)
        throw new Error("ZKas daemon response exceeded its limit");
      parts.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return new Response(bytes, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

function fixedFetch(
  origin: string,
  bearer: string | undefined,
  assertCurrent: () => Promise<void>,
  signal: AbortSignal,
  assertSynchronous?: () => void,
): typeof fetch {
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const requested = String(input);
    const method = init?.method ?? "GET";
    if (!requested.startsWith(`${origin}/`))
      throw new Error("Invalid ZKas daemon route");
    const path = requested.slice(origin.length);
    const maxBytes = routes.get(`${method} ${path}`);
    if (maxBytes === undefined) throw new Error("Invalid ZKas daemon route");
    if (method === "POST") {
      if (typeof init?.body !== "string" || init.body.length > 2_048)
        throw new Error("Invalid ZKas watch request");
      let parsed: unknown;
      try {
        parsed = JSON.parse(init.body);
      } catch {
        throw new Error("Invalid ZKas watch request");
      }
      if (
        !z
          .object({
            fvk_hex: z.string().regex(/^[0-9a-fA-F]{192}$/),
            birthday: z.number().int().nonnegative().safe(),
            recoverable_history: z.literal(true),
          })
          .strict()
          .safeParse(parsed).success
      )
        throw new Error("Invalid ZKas watch request");
    } else if (init?.body !== undefined) {
      throw new Error("Invalid ZKas daemon request");
    }
    const incoming = new Headers(init?.headers);
    for (const name of incoming.keys())
      if (name !== "x-wallet-token" && name !== "content-type")
        throw new Error("Invalid ZKas daemon request");
    await assertCurrent();
    assertSynchronous?.();
    assertLive(signal);
    const headers = new Headers(incoming);
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
    const combined = init?.signal
      ? AbortSignal.any([signal, init.signal])
      : signal;
    const response = await globalThis.fetch(requested, {
      method,
      headers,
      ...(init?.body === undefined ? {} : { body: init.body }),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: combined,
    });
    await assertCurrent();
    assertLive(signal);
    if (response.url && response.url !== requested)
      throw new Error("ZKas daemon redirected");
    return boundedResponse(response, maxBytes, assertCurrent, signal);
  }) as typeof fetch;
}

function matchesAccount(
  credentials: ZKasCredentials,
  expected: z.infer<typeof selection> | undefined,
): boolean {
  return (
    !expected ||
    (credentials.walletId === expected.walletId &&
      credentials.accountIndex === expected.accountIndex &&
      credentials.network === expected.network &&
      (expected.address === undefined ||
        credentials.address === expected.address))
  );
}

async function accountOperation<T>(
  expected: z.infer<typeof selection> | undefined,
  expectedOrigin: string | undefined,
  operation: (client: ZKasClient, credentials: ZKasCredentials) => Promise<T>,
  website?: {
    origin: string;
    selection: z.infer<typeof selection>;
    publish(result: T): void;
  },
): Promise<T> {
  return withinDeadline(async (signal) => {
    const keyring = ExtensionService.getInstance().getKeyring();
    if (!keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    const session = keyring.getSessionVersion();
    const walletsGeneration = keyring.getMutationGeneration("wallets");
    const websiteGeneration = website && zkasConnectionStore.getGeneration();
    const assertWebsite = async () => {
      if (!website) return;
      const connections = await zkasConnectionStore.list();
      assertLive(signal);
      if (
        zkasConnectionStore.getGeneration() !== websiteGeneration ||
        !hasZKasConnection(connections, website.origin, website.selection)
      )
        throw new Error("Connect this website to ZKas first");
    };
    const assertGenerations = () => {
      assertLive(signal);
      if (
        !keyring.isUnlocked() ||
        keyring.getSessionVersion() !== session ||
        keyring.getMutationGeneration("wallets") !== walletsGeneration ||
        keyring.getMutationGeneration(DAEMON_BEARERS_KEY) !== bearerGeneration
      )
        throw new Error("Selected ZKas account changed");
      if (website && zkasConnectionStore.getGeneration() !== websiteGeneration)
        throw new Error("Connect this website to ZKas first");
    };
    const credentials = await zkasKeyService.credentials();
    assertLive(signal);
    if (!matchesAccount(credentials, expected))
      throw new Error("Selected ZKas account changed");
    if (!credentials.daemonUrl)
      throw new Error("Configure a ZKas daemon first");
    const origin = canonicalDaemonBearerOrigin(credentials.daemonUrl);
    if (
      expectedOrigin !== undefined &&
      origin !== canonicalDaemonBearerOrigin(expectedOrigin)
    )
      throw new Error("Selected ZKas daemon changed");
    const source = await sourceGuard(origin, signal);
    const bearerGeneration = keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    const assertCurrent = async () => {
      await assertWebsite();
      await source.assertCurrent();
      assertGenerations();
      await zkasKeyService.checkSelection(
        credentials,
        credentials.daemonUrl,
        credentials.keyringVersion,
      );
      await source.assertCurrent();
      assertGenerations();
    };
    await assertCurrent();
    const result = await new DaemonBearerStore(keyring).withBearer(
      origin,
      assertCurrent,
      async (bearer) => {
        await assertCurrent();
        const client = new ZKasClient({
          baseUrl: origin,
          network: credentials.network,
          token: credentials.walletToken,
          fetch: fixedFetch(
            origin,
            bearer,
            assertCurrent,
            signal,
            assertGenerations,
          ),
          guard: assertCurrent,
        });
        const result = await operation(client, credentials);
        await assertCurrent();
        return result;
      },
    );
    if (website) {
      await assertCurrent();
      assertGenerations();
      website.publish(result);
    }
    return result;
  });
}

export async function daemonBirthday(
  message: Message,
  sendResponse: (value: unknown) => void,
): Promise<void> {
  const request = checked(birthdayRequest, message);
  const result = await withinDeadline(async (signal) => {
    const origin = canonicalDaemonBearerOrigin(request.origin);
    const source = await sourceGuard(origin, signal);
    const keyring = source.keyring;
    const bearerGeneration = keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    const assertCurrent = async () => {
      await source.assertCurrent();
      if (
        keyring.getMutationGeneration(DAEMON_BEARERS_KEY) !== bearerGeneration
      )
        throw new Error("ZKas daemon credential changed");
    };
    const run = async (bearer: string | undefined) =>
      probeZKasDaemonBirthday(
        origin,
        request.network,
        fixedFetch(origin, bearer, assertCurrent, signal),
      );
    if (!keyring.isUnlocked()) return run(undefined);
    return new DaemonBearerStore(keyring).withBearer(
      origin,
      assertCurrent,
      run,
    );
  });
  sendResponse({ birthday: result });
}

export async function daemonRegister(
  message: Message,
  sendResponse: (value: unknown) => void,
): Promise<void> {
  const request = checked(registerRequest, message);
  await accountOperation(
    request.expectedAccount,
    request.expectedOrigin,
    async (client, credentials) => {
      await client.register(
        credentials.fullViewingKeyHex,
        credentials.address,
        request.birthday,
      );
    },
  );
  sendResponse({ registered: true });
}

export async function daemonState(
  message: Message,
  sendResponse: (value: unknown) => void,
): Promise<void> {
  const request = checked(stateRequest, message);
  const state = await privateDaemonState(request.expectedAccount);
  sendResponse({ ...state, balanceSompi: state.balanceSompi.toString() });
}

export async function privateDaemonState(expected?: z.infer<typeof selection>) {
  return accountOperation(expected, undefined, (client, credentials) =>
    client.state(credentials.fullViewingKeyHex, credentials.address),
  );
}

export async function privateDaemonWebsiteBalance(
  expected: z.infer<typeof selection>,
  websiteOrigin: string,
  publish: (value: {
    address: string;
    network: "mainnet" | "testnet";
    balanceSompi: string;
    synced: boolean;
    missingHistory: boolean;
  }) => void,
): Promise<void> {
  await accountOperation(
    expected,
    undefined,
    (client, credentials) =>
      client.state(credentials.fullViewingKeyHex, credentials.address),
    {
      origin: websiteOrigin,
      selection: expected,
      publish: (state) => {
        publish({
          address: state.address,
          network: expected.network,
          balanceSompi: state.balanceSompi.toString(),
          synced: state.synced,
          missingHistory: state.missingHistory,
        });
      },
    },
  );
}

export async function daemonRecentHistory(
  message: Message,
  sendResponse: (value: unknown) => void,
): Promise<void> {
  const request = checked(historyRequest, message);
  const history = await accountOperation(
    request.expectedAccount,
    undefined,
    async (client, credentials) => {
      await client.state(credentials.fullViewingKeyHex, credentials.address);
      return client.history();
    },
  );
  sendResponse(history);
}
