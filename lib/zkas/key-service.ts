import type { Settings } from "@/contexts/SettingsContext";
import { SETTINGS_KEY } from "@/contexts/SettingsContext";
import type { WalletSettings } from "@/contexts/WalletManagerContext";
import { WALLET_SETTINGS } from "@/contexts/WalletManagerContext";
import { ExtensionService } from "@/lib/service/extension-service";
import { updateWalletSettingsLocked } from "@/lib/wallet-settings-storage";
import type { WalletSecret } from "@/types/WalletSecret";
import signerAssetUrl from "@/wasm/zkas-signer/firecash_signer_bg.wasm?url";
import { parseZkasSompi } from "./amount";
import { validateZKasMemo } from "./memo";
import {
  deriveZKasAccount,
  deriveZKasAccountFromSeed,
  initZKasSigner,
} from "./signer";
import {
  addOrRecoverZKasSeed,
  getSelectedAvailableZKasAddress,
  getZKasSecretSource,
  listZKasSwitchAccounts,
  loadSelectedZKasAccount,
  normalizeZKasSeedHex,
  sameZKasSelection,
  type ZKasSelection,
} from "./selection";
import {
  getVisibleWalletNetworks,
  isZKasActive,
  ZKAS_EXPERIMENTAL_KEY,
  ZKAS_MAINNET,
} from "@/lib/wallet-network";

export type ZKasCredentials = ZKasSelection & {
  keyringVersion: number;
  address: string;
  fullViewingKeyHex: string;
  walletToken: string;
  daemonUrl: string | undefined;
};

export type ZKasSignRequest = {
  selection: ZKasSelection;
  keyringVersion: number;
  daemonUrl: string;
  recipient: string;
  amountSompi: string;
  maxFeeSompi: string;
  memo: string;
  bundleHex: string;
  disclosure: unknown[];
  spendAuth: unknown[];
};

export class ZKasKeyService {
  private importTail: Promise<void> = Promise.resolve();

  private async available(): Promise<{
    settings: Settings;
    walletSettings: WalletSettings;
    keyringVersion: number;
  }> {
    const keyring = ExtensionService.getInstance().getKeyring();
    if (!keyring.isUnlocked()) throw new Error("Unlock Kastle to use ZKas");
    const keyringVersion = keyring.getSessionVersion();
    const [settings, walletSettings, enabled] = await Promise.all([
      storage.getItem<Settings>(SETTINGS_KEY),
      storage.getItem<WalletSettings>(WALLET_SETTINGS),
      storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
    ]);
    if (
      !settings ||
      !walletSettings ||
      !getVisibleWalletNetworks(settings, enabled).includes(ZKAS_MAINNET)
    ) {
      throw new Error("Enable Experimental features to import a ZKas wallet");
    }
    if (
      !keyring.isUnlocked() ||
      keyring.getSessionVersion() !== keyringVersion
    ) {
      throw new Error("Kastle lock state changed during the ZKas request");
    }
    return { settings, walletSettings, keyringVersion };
  }

  async switchAccounts(): Promise<
    Awaited<ReturnType<typeof listZKasSwitchAccounts>>
  > {
    const { keyringVersion, settings } = await this.available();
    const enabled = await storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY);
    if (!isZKasActive(settings, enabled))
      throw new Error("Select ZKas Mainnet to view ZKas wallets");
    const keyring = ExtensionService.getInstance().getKeyring();
    const walletSettings =
      await storage.getItem<WalletSettings>(WALLET_SETTINGS);
    if (!walletSettings) throw new Error("Wallet settings are unavailable");
    const secrets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
    await initZKasSigner(signerAssetUrl);
    const accounts = await listZKasSwitchAccounts(
      walletSettings,
      secrets,
      async (source, index) => {
        const derived =
          source.type === "mnemonic"
            ? await deriveZKasAccount(source.value, index, "mainnet")
            : await deriveZKasAccountFromSeed(source.value, "mainnet");
        return derived.address;
      },
    );
    const latest = await this.available();
    if (
      keyring.getSessionVersion() !== keyringVersion ||
      !isZKasActive(
        latest.settings,
        await storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
      ) ||
      JSON.stringify(await storage.getItem<WalletSettings>(WALLET_SETTINGS)) !==
        JSON.stringify(walletSettings)
    ) {
      throw new Error("Wallets changed while loading the ZKas switcher");
    }
    return accounts;
  }

  private async selected(): Promise<{
    selection: ZKasSelection;
    settings: Settings;
    keyringVersion: number;
  }> {
    const keyring = ExtensionService.getInstance().getKeyring();
    return loadSelectedZKasAccount(
      keyring,
      () => storage.getItem<WalletSettings>(WALLET_SETTINGS),
      () => storage.getItem<Settings>(SETTINGS_KEY),
      () => storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
    );
  }

  async checkSelection(
    selection: ZKasSelection,
    daemonUrl?: string,
    expectedKeyringVersion?: number,
  ): Promise<void> {
    const current = await this.selected();
    if (
      expectedKeyringVersion !== undefined &&
      current.keyringVersion !== expectedKeyringVersion
    ) {
      throw new Error("Kastle lock state changed during the ZKas request");
    }
    if (!sameZKasSelection(selection, current.selection)) {
      throw new Error("Selected wallet, account, or network changed");
    }
    if (
      daemonUrl !== undefined &&
      current.settings.zkasDaemonUrls?.[selection.network] !== daemonUrl
    ) {
      throw new Error("Selected ZKas daemon changed");
    }
  }

  private async account(): Promise<{
    selection: ZKasSelection;
    settings: Settings;
    keyringVersion: number;
    derived: Awaited<ReturnType<typeof deriveZKasAccount>>;
  }> {
    const { selection, settings, keyringVersion } = await this.selected();
    const keyring = ExtensionService.getInstance().getKeyring();
    const secrets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
    const source = getZKasSecretSource(secrets, selection);
    await initZKasSigner(signerAssetUrl);
    let derived: Awaited<ReturnType<typeof deriveZKasAccount>>;
    try {
      derived =
        source.type === "mnemonic"
          ? await deriveZKasAccount(
              source.value,
              selection.accountIndex,
              selection.network,
            )
          : await deriveZKasAccountFromSeed(source.value, selection.network);
    } catch {
      throw new Error("Unable to derive the selected ZKas account");
    }
    await this.checkSelection(selection, undefined, keyringVersion);
    return { selection, settings, keyringVersion, derived };
  }

  async publicAccount(): Promise<ZKasSelection & { address: string }> {
    const { selection, derived } = await this.account();
    return { ...selection, address: derived.address };
  }

  async selectedAddress(): Promise<
    (ZKasSelection & { address: string }) | null
  > {
    const keyring = ExtensionService.getInstance().getKeyring();
    if (!keyring.isUnlocked())
      throw new Error("Unlock Kastle to read the ZKas address");
    const keyringVersion = keyring.getSessionVersion();
    const [walletSettings, settings, enabled] = await Promise.all([
      storage.getItem<WalletSettings>(WALLET_SETTINGS),
      storage.getItem<Settings>(SETTINGS_KEY),
      storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
    ]);
    if (
      !walletSettings ||
      !settings ||
      !getVisibleWalletNetworks(settings, enabled).includes(ZKAS_MAINNET)
    ) {
      throw new Error("Enable Experimental features to read the ZKas address");
    }
    const secrets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
    const account = await getSelectedAvailableZKasAddress(
      walletSettings,
      secrets,
      async (source, index) => {
        await initZKasSigner(signerAssetUrl);
        const derived =
          source.type === "mnemonic"
            ? await deriveZKasAccount(source.value, index, "mainnet")
            : await deriveZKasAccountFromSeed(source.value, "mainnet");
        return derived.address;
      },
    );
    const latestEnabled = await storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY);
    const latestSettings = await storage.getItem<Settings>(SETTINGS_KEY);
    const latestWalletSettings =
      await storage.getItem<WalletSettings>(WALLET_SETTINGS);
    if (
      !keyring.isUnlocked() ||
      keyring.getSessionVersion() !== keyringVersion ||
      !latestSettings ||
      !getVisibleWalletNetworks(latestSettings, latestEnabled).includes(
        ZKAS_MAINNET,
      ) ||
      latestWalletSettings?.selectedWalletId !==
        walletSettings.selectedWalletId ||
      latestWalletSettings?.selectedAccountIndex !==
        walletSettings.selectedAccountIndex
    ) {
      throw new Error("ZKas account changed while reading the address");
    }
    return account;
  }

  async previewSeed(
    rawSeed: string,
  ): Promise<{ network: "mainnet"; address: string }> {
    const { keyringVersion } = await this.available();
    const seedHex = normalizeZKasSeedHex(rawSeed);
    await initZKasSigner(signerAssetUrl);
    let address: string;
    try {
      address = (await deriveZKasAccountFromSeed(seedHex, "mainnet")).address;
    } catch {
      throw new Error("Invalid ZKas spending seed");
    }
    const keyring = ExtensionService.getInstance().getKeyring();
    await this.available();
    if (keyring.getSessionVersion() !== keyringVersion)
      throw new Error("Kastle lock state changed during the ZKas request");
    return { network: "mainnet", address };
  }

  async importSeed(
    rawSeed: string,
    expectedAccount: { network: "mainnet"; address: string },
  ): Promise<ZKasSelection & { address: string }> {
    const operation = this.importTail.then(async () => {
      const preview = await this.previewSeed(rawSeed);
      if (
        expectedAccount?.network !== "mainnet" ||
        preview.address !== expectedAccount.address
      ) {
        throw new Error("ZKas address changed. Preview the seed again");
      }
      const { keyringVersion } = await this.available();
      const keyring = ExtensionService.getInstance().getKeyring();
      const seed = normalizeZKasSeedHex(rawSeed);
      let id: string = crypto.randomUUID();
      await updateWalletSettingsLocked<WalletSettings>(
        WALLET_SETTINGS,
        async (walletSettings) => {
          await this.available();
          if (keyring.getSessionVersion() !== keyringVersion)
            throw new Error("Kastle lock state changed during import");
          await keyring.updateValue<WalletSecret[]>("wallets", (current) => {
            const result = addOrRecoverZKasSeed(
              current ?? [],
              walletSettings,
              seed,
              id,
            );
            if (keyring.getSessionVersion() !== keyringVersion)
              throw new Error("Kastle lock state changed during import");
            id = result.id;
            return result.secrets;
          });
          const nextNumber = (walletSettings.lastZKasSeedNumber ?? 0) + 1;
          return {
            ...walletSettings,
            selectedWalletId: id,
            selectedAccountIndex: 0,
            lastZKasSeedNumber: nextNumber,
            wallets: [
              ...walletSettings.wallets,
              {
                id,
                type: "zkasSeed",
                name: `ZKas seed ${nextNumber}`,
                accounts: [
                  {
                    index: 0,
                    name: "Account 0",
                    address: preview.address,
                  },
                ],
                backed: true,
              },
            ],
          };
        },
      );
      return {
        walletId: id,
        accountIndex: 0,
        network: "mainnet" as const,
        address: preview.address,
      };
    });
    this.importTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async credentials(): Promise<ZKasCredentials> {
    const { selection, settings, keyringVersion, derived } =
      await this.account();
    const fullViewingKeyHex = await derived.signer.fullViewingKeyHex();
    await this.checkSelection(
      selection,
      settings.zkasDaemonUrls?.[selection.network],
      keyringVersion,
    );
    return {
      ...selection,
      keyringVersion,
      address: derived.address,
      fullViewingKeyHex,
      walletToken: derived.token,
      daemonUrl: settings.zkasDaemonUrls?.[selection.network],
    };
  }

  async sign(
    request: ZKasSignRequest,
  ): Promise<{ index: number; sig: string }[]> {
    await this.checkSelection(
      request.selection,
      request.daemonUrl,
      request.keyringVersion,
    );
    if (
      typeof request.recipient !== "string" ||
      typeof request.bundleHex !== "string" ||
      request.bundleHex.length > 2_000_000 ||
      !Array.isArray(request.disclosure) ||
      !Array.isArray(request.spendAuth)
    ) {
      throw new Error("Invalid ZKas signing request");
    }
    const amountSompi = parseZkasSompi(request.amountSompi, "amount");
    const maxFeeSompi = parseZkasSompi(request.maxFeeSompi, "fee ceiling");
    const memo = validateZKasMemo(request.memo) ?? "";
    const { derived, keyringVersion } = await this.account();
    if (keyringVersion !== request.keyringVersion)
      throw new Error("Kastle lock state changed during the ZKas request");
    await this.checkSelection(
      request.selection,
      request.daemonUrl,
      request.keyringVersion,
    );
    const signatures = await derived.signer.verifyAndSign({
      network: request.selection.network,
      recipient: request.recipient,
      amountSompi,
      maxFeeSompi,
      memo,
      bundleHex: request.bundleHex,
      disclosure: request.disclosure,
      spendAuth: request.spendAuth,
    });
    await this.checkSelection(
      request.selection,
      request.daemonUrl,
      request.keyringVersion,
    );
    return signatures;
  }
}

export const zkasKeyService = new ZKasKeyService();
