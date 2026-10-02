import { z } from "zod";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import {
  canonicalDaemonBearerOrigin,
  DaemonBearerStore,
} from "@/lib/zkas/daemon-bearer";
import { ExtensionService, type Message } from "../extension-service";
import { Method } from "../methods";

const PairSchema = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_BEARER_PAIR),
    origin: z.string().max(256),
    bearer: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const ListSchema = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_BEARER_LIST),
  })
  .strict();
const ClearSchema = z
  .object({
    method: z.literal(Method.ZKAS_DAEMON_BEARER_CLEAR),
    origin: z.string().max(256),
    expectedRevision: z.string().uuid(),
  })
  .strict();

function checked<T>(schema: z.ZodType<T>, message: unknown): T {
  const parsed = schema.safeParse(message);
  if (!parsed.success) throw new Error("Invalid daemon pairing request");
  return parsed.data;
}

function sourceSnapshot(settings: Settings | null): string {
  return JSON.stringify([
    settings?.networkId ?? null,
    settings?.zkasDaemonUrls ?? null,
  ]);
}

async function context(origin?: string) {
  const keyring = ExtensionService.getInstance().getKeyring();
  if (!keyring.isUnlocked()) throw new Error("Unlock Kastle first");
  const session = keyring.getSessionVersion();
  const originalSettings = await storage.getItem<Settings>(SETTINGS_KEY);
  if (!keyring.isUnlocked() || keyring.getSessionVersion() !== session)
    throw new Error("Daemon pairing context changed");
  const source = sourceSnapshot(originalSettings);
  const assertCurrent = async () => {
    if (!keyring.isUnlocked() || keyring.getSessionVersion() !== session)
      throw new Error("Daemon pairing context changed");
    const latest = await storage.getItem<Settings>(SETTINGS_KEY);
    if (
      !keyring.isUnlocked() ||
      keyring.getSessionVersion() !== session ||
      sourceSnapshot(latest) !== source
    )
      throw new Error("Daemon pairing context changed");
    if (origin !== undefined) {
      const parsed = new URL(origin);
      const pattern = `${parsed.protocol}//${parsed.hostname}/*`;
      let permitted = false;
      try {
        permitted = await browser.permissions.contains({ origins: [pattern] });
      } catch {
        throw new Error("Daemon pairing permission changed");
      }
      if (
        !keyring.isUnlocked() ||
        keyring.getSessionVersion() !== session ||
        !permitted
      )
        throw new Error("Daemon pairing permission changed");
      const afterPermission = await storage.getItem<Settings>(SETTINGS_KEY);
      if (
        !keyring.isUnlocked() ||
        keyring.getSessionVersion() !== session ||
        sourceSnapshot(afterPermission) !== source
      )
        throw new Error("Daemon pairing context changed");
    }
  };
  await assertCurrent();
  return {
    keyring,
    configured: originalSettings?.zkasDaemonUrls,
    assertCurrent,
  };
}

export const zkasDaemonBearerPair = async (
  message: Message,
  sendResponse: (value: unknown) => void,
) => {
  const request = checked(PairSchema, message);
  const origin = canonicalDaemonBearerOrigin(request.origin);
  const current = await context(origin);
  const paired = await new DaemonBearerStore(current.keyring).pair(
    origin,
    request.bearer,
    current.assertCurrent,
  );
  await current.assertCurrent();
  sendResponse({ ...paired, present: true });
};

export const zkasDaemonBearerList = async (
  message: Message,
  sendResponse: (value: unknown) => void,
) => {
  checked(ListSchema, message);
  const current = await context();
  const rows = await new DaemonBearerStore(current.keyring).list(
    current.assertCurrent,
  );
  let selectedOrigin: string | null = null;
  try {
    if (current.configured?.mainnet)
      selectedOrigin = canonicalDaemonBearerOrigin(current.configured.mainnet);
  } catch {
    // Invalid settings cannot make a saved credential current.
  }
  await current.assertCurrent();
  sendResponse({
    records: rows.map((row) => ({
      ...row,
      sourceStatus:
        selectedOrigin === null
          ? "unconfigured"
          : row.origin === selectedOrigin
            ? "current"
            : "stale",
    })),
  });
};

export const zkasDaemonBearerClear = async (
  message: Message,
  sendResponse: (value: unknown) => void,
) => {
  const request = checked(ClearSchema, message);
  const current = await context();
  await new DaemonBearerStore(current.keyring).clear(
    request.origin,
    request.expectedRevision,
    current.assertCurrent,
  );
  await current.assertCurrent();
  sendResponse({ cleared: true });
};
