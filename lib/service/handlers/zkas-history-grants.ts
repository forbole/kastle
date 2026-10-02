import { z } from "zod";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import {
  canonicalHistoryDaemonOrigin,
  canonicalHistoryIndexOrigin,
  ZKAS_MAINNET_GENESIS,
} from "@/lib/zkas/history-config";
import {
  HISTORY_GRANTS_KEY,
  HistoryGrantStore,
  type HistoryGrantAccount,
  type HistoryGrantContext,
  type HistoryGrantListView,
} from "@/lib/zkas/history-grant";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection, type ZKasSelection } from "@/lib/zkas/selection";
import { assertZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";
import { ExtensionService, type Message } from "../extension-service";
import { Method } from "../methods";

const ListRequestSchema = z
  .object({ method: z.literal(Method.ZKAS_HISTORY_GRANTS_LIST) })
  .strict();
const RevokeRequestSchema = z
  .object({
    method: z.literal(Method.ZKAS_HISTORY_GRANT_REVOKE_SAVED),
    origin: z.string().max(256),
    expectedRevision: z.string().uuid(),
  })
  .strict();

type CurrentAccount = ZKasSelection & { address: string };

function sameSelected(a: CurrentAccount, b: CurrentAccount): boolean {
  return sameZKasSelection(a, b) && a.address === b.address;
}

function sourcePair(
  settings: Settings | null,
): { daemonUrl: string; indexUrl: string } | null {
  try {
    if (
      !settings?.zkasDaemonUrls?.mainnet ||
      !settings.zkasHistoryIndexUrls?.mainnet
    )
      return null;
    return {
      daemonUrl: canonicalHistoryDaemonOrigin(settings.zkasDaemonUrls.mainnet),
      indexUrl: canonicalHistoryIndexOrigin(
        settings.zkasHistoryIndexUrls.mainnet,
      ),
    };
  } catch {
    return null;
  }
}

async function selectedAccount() {
  const keyring = ExtensionService.getInstance().getKeyring();
  if (!keyring.isUnlocked()) throw new Error("Unlock Kastle first");
  const session = keyring.getSessionVersion();
  const generation = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
  const selected = await zkasKeyService.publicAccount();
  if (
    !keyring.isUnlocked() ||
    keyring.getSessionVersion() !== session ||
    keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== generation ||
    selected.network !== "mainnet"
  )
    throw new Error("Selected ZKas account changed");
  const account: HistoryGrantAccount = {
    walletId: selected.walletId,
    accountIndex: selected.accountIndex,
    address0: selected.address,
    network: "mainnet",
    genesis: ZKAS_MAINNET_GENESIS,
  };
  const assertAccount = async () => {
    if (!keyring.isUnlocked() || keyring.getSessionVersion() !== session)
      throw new Error("History grant context changed");
    const latest = await zkasKeyService.publicAccount();
    if (
      !keyring.isUnlocked() ||
      keyring.getSessionVersion() !== session ||
      !sameSelected(selected, latest)
    )
      throw new Error("Selected ZKas account changed");
  };
  const assertCurrent = async () => {
    if (keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== generation)
      throw new Error("History grant context changed");
    await assertAccount();
    if (keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== generation)
      throw new Error("History grant context changed");
  };
  return { keyring, selected, account, assertAccount, assertCurrent };
}

export const zkasHistoryGrantsList = async (
  message: Message,
  sendResponse: (value: unknown) => void,
) => {
  ListRequestSchema.parse(message);
  const current = await selectedAccount();
  const [settings, enabled, connections] = await Promise.all([
    storage.getItem<Settings>(SETTINGS_KEY),
    storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
    zkasConnectionStore.list(),
  ]);
  await current.assertCurrent();
  assertZKasActive(settings, enabled);
  const sourceSnapshot = JSON.stringify([
    settings?.zkasDaemonUrls?.mainnet ?? null,
    settings?.zkasHistoryIndexUrls?.mainnet ?? null,
    enabled,
    connections,
  ]);
  const assertPresentation = async () => {
    await current.assertCurrent();
    const [latestSettings, latestEnabled, latestConnections] =
      await Promise.all([
        storage.getItem<Settings>(SETTINGS_KEY),
        storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
        zkasConnectionStore.list(),
      ]);
    await current.assertCurrent();
    assertZKasActive(latestSettings, latestEnabled);
    if (
      JSON.stringify([
        latestSettings?.zkasDaemonUrls?.mainnet ?? null,
        latestSettings?.zkasHistoryIndexUrls?.mainnet ?? null,
        latestEnabled,
        latestConnections,
      ]) !== sourceSnapshot
    )
      throw new Error("History settings changed; refresh the list");
  };
  const records = await new HistoryGrantStore(current.keyring).listForAccount(
    current.account,
    assertPresentation,
  );
  const configured = sourcePair(settings);
  const result: HistoryGrantListView = {
    account: {
      walletId: current.account.walletId,
      accountIndex: current.account.accountIndex,
      address0: current.account.address0,
      network: "mainnet",
    },
    records: records.map((record) => ({
      origin: record.audience.kind === "website" ? record.audience.origin : "",
      scope: record.scope,
      revision: record.revision,
      daemonUrl: record.daemonUrl,
      indexUrl: record.indexUrl,
      sourceStatus: !configured
        ? "unconfigured"
        : configured.daemonUrl === record.daemonUrl &&
            configured.indexUrl === record.indexUrl
          ? "current"
          : "stale",
      connectionStatus:
        record.audience.kind === "website" &&
        hasZKasConnection(connections, record.audience.origin, current.selected)
          ? "connected"
          : "disconnected",
    })),
  };
  await assertPresentation();
  sendResponse(result);
};

export const zkasHistoryGrantRevokeSaved = async (
  message: Message<{ origin: string; expectedRevision: string }>,
  sendResponse: (value: unknown) => void,
) => {
  const { origin, expectedRevision } = RevokeRequestSchema.parse(message);
  const current = await selectedAccount();
  const store = new HistoryGrantStore(current.keyring);
  const records = await store.listForAccount(
    current.account,
    current.assertCurrent,
  );
  const saved = records.find(
    (record) =>
      record.audience.kind === "website" && record.audience.origin === origin,
  );
  if (!saved || saved.revision !== expectedRevision)
    throw new Error("History grant view is stale");
  await current.assertCurrent();
  const captured: HistoryGrantContext = {
    audience: saved.audience,
    walletId: saved.walletId,
    accountIndex: saved.accountIndex,
    address0: saved.address0,
    network: saved.network,
    genesis: saved.genesis,
    daemonUrl: saved.daemonUrl,
    indexUrl: saved.indexUrl,
  };
  await store.revokeIfRevision(
    captured,
    expectedRevision,
    current.assertAccount,
  );
  sendResponse({ revoked: true });
};
