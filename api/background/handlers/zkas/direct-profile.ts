import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import {
  WALLET_SETTINGS,
  type WalletSettings,
} from "@/contexts/WalletManagerContext";
import { isTrustedZKasPageRequest } from "@/api/background/zkas-origin";
import { ExtensionService } from "@/lib/service/extension-service";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection } from "@/lib/zkas/selection";
import { withWalletSettingsLock } from "@/lib/wallet-settings-storage";
import { withSettingsLock } from "@/lib/settings-storage";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import { isZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";
import { directReceiveRegistry } from "@/lib/zkas/direct-receive";

const protocolId = "matjam-onchain-v3";
type PublicProfile = Awaited<
  ReturnType<typeof zkasKeyService.publicMessagingProfile>
>;

async function connectedProfile(
  origin: string | undefined,
  payload: unknown,
  sender: chrome.runtime.MessageSender,
  deliver: (profile: PublicProfile) => void | Promise<void>,
): Promise<void> {
  if (
    payload !== undefined ||
    !origin ||
    !isTrustedZKasPageRequest(origin, sender, browser.runtime.id)
  ) {
    throw new Error("Invalid private messaging website request");
  }
  const keyring = ExtensionService.getInstance().getKeyring();
  const session = keyring.getSessionVersion();
  const generation = zkasConnectionStore.getGeneration();
  const assertLease = () => {
    if (
      !keyring.isUnlocked() ||
      keyring.isPrivateWalletWorkPending() ||
      keyring.getSessionVersion() !== session ||
      zkasConnectionStore.getGeneration() !== generation
    ) {
      throw new Error(
        "Private messaging account or website connection changed",
      );
    }
  };
  assertLease();
  const account = await zkasKeyService.publicAccount();
  assertLease();
  if (account.network !== "mainnet")
    throw new Error("Select ZKas Mainnet first");
  const assertConnected = async () => {
    assertLease();
    const connections = await zkasConnectionStore.list();
    assertLease();
    if (!hasZKasConnection(connections, origin, account))
      throw new Error("Connect this website to ZKas first");
  };
  await assertConnected();
  await zkasKeyService.checkSelection(account, undefined, session);
  assertLease();
  const profile = await zkasKeyService.publicMessagingProfile();
  assertLease();
  if (
    profile.protocolId !== protocolId ||
    profile.accountAddress !== account.address ||
    !/^[0-9a-f]{32}$/.test(profile.peerId) ||
    !/^[0-9a-f]{368}$/.test(profile.publicCard)
  ) {
    throw new Error("Selected private messaging profile changed");
  }
  const actor = await zkasKeyService.openPrivateMessagingSession();
  try {
    if (actor.address !== account.address)
      throw new Error("Selected private messaging account changed");
    const after = await zkasKeyService.publicAccount();
    assertLease();
    if (!sameZKasSelection(account, after) || after.address !== account.address)
      throw new Error("Selected private messaging account changed");
    await assertConnected();
    await actor.assertCurrent();
    // All in-repo selection and network writers use these extension-origin locks.
    // The order matches the existing wallet-then-settings setup path. Hold them
    // only for the final reads and synchronous response, never for key loading.
    await withWalletSettingsLock(() =>
      withSettingsLock(async () => {
        const walletSettings =
          await storage.getItem<WalletSettings>(WALLET_SETTINGS);
        assertLease();
        const selectedAddress = walletSettings?.wallets
          .find((wallet) => wallet.id === account.walletId)
          ?.accounts.find(
            (entry) => entry.index === account.accountIndex,
          )?.address;
        if (
          walletSettings?.selectedWalletId !== account.walletId ||
          walletSettings.selectedAccountIndex !== account.accountIndex ||
          selectedAddress !== account.address
        ) {
          throw new Error("Selected private messaging account changed");
        }
        const settings = await storage.getItem<Settings>(SETTINGS_KEY);
        assertLease();
        const enabled = await storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY);
        assertLease();
        if (!isZKasActive(settings, enabled))
          throw new Error("Select ZKas Mainnet first");
        await actor.assertCurrent();
        const currentCard = Array.from(actor.publicCard(), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (currentCard !== profile.publicCard)
          throw new Error("Selected private messaging profile changed");
        assertLease();
        await deliver(profile);
      }),
    );
  } finally {
    actor.close();
  }
}

export const zkasDirectProfileHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
  sender,
) => {
  await connectedProfile(message.origin, message.payload, sender, (profile) =>
    sendResponse(ApiUtils.createApiResponse(message.id, profile)),
  );
};

export const zkasDirectViewHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
  sender,
) => {
  let initial: PublicProfile | undefined;
  await connectedProfile(message.origin, message.payload, sender, (profile) => {
    initial = profile;
  });
  if (!initial || !message.origin)
    throw new Error("Private direct profile unavailable");
  const prepared = await directReceiveRegistry.read(message.origin, initial);
  try {
    await connectedProfile(
      message.origin,
      message.payload,
      sender,
      async (profile) => {
        if (
          !initial ||
          profile.accountAddress !== initial.accountAddress ||
          profile.peerId !== initial.peerId ||
          profile.publicCard !== initial.publicCard
        )
          throw new Error("Private direct account changed");
        await prepared.assertCurrent();
        prepared.assertImmediate();
        sendResponse(ApiUtils.createApiResponse(message.id, prepared.view));
      },
    );
  } catch (error) {
    directReceiveRegistry.close();
    throw error;
  }
};
