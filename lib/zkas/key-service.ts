import type { Settings } from "@/contexts/SettingsContext";
import { SETTINGS_KEY } from "@/contexts/SettingsContext";
import type { WalletSettings } from "@/contexts/WalletManagerContext";
import { WALLET_SETTINGS } from "@/contexts/WalletManagerContext";
import { ExtensionService } from "@/lib/service/extension-service";
import type { WalletSecret } from "@/types/WalletSecret";
import signerAssetUrl from "@/wasm/zkas-signer/firecash_signer_bg.wasm?url";
import { parseZkasSompi } from "./amount";
import { deriveZKasAccount, deriveZKasAccountFromSeed, initZKasSigner } from "./signer";
import { attachZKasSeed, getSelectedAvailableZKasAddress, getZKasSecretSource, loadSelectedZKasAccount, normalizeZKasSeedHex, sameZKasSelection, type ZKasSelection } from "./selection";
import { getVisibleWalletNetworks, ZKAS_EXPERIMENTAL_KEY, ZKAS_MAINNET } from "@/lib/wallet-network";
import { getZKasPaymentJournal } from "./payment-journal";

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
  bundleHex: string;
  disclosure: unknown[];
  spendAuth: unknown[];
};

export class ZKasKeyService {
  private async selected(): Promise<{ selection: ZKasSelection; settings: Settings; keyringVersion: number }> {
    const keyring = ExtensionService.getInstance().getKeyring();
    return loadSelectedZKasAccount(
      keyring,
      () => storage.getItem<WalletSettings>(WALLET_SETTINGS),
      () => storage.getItem<Settings>(SETTINGS_KEY),
      () => storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
    );
  }

  async checkSelection(selection: ZKasSelection, daemonUrl?: string, expectedKeyringVersion?: number): Promise<void> {
    const current = await this.selected();
    if (expectedKeyringVersion !== undefined && current.keyringVersion !== expectedKeyringVersion) {
      throw new Error("Kastle lock state changed during the ZKas request");
    }
    if (!sameZKasSelection(selection, current.selection)) {
      throw new Error("Selected wallet, account, or network changed");
    }
    if (daemonUrl !== undefined && current.settings.zkasDaemonUrls?.[selection.network] !== daemonUrl) {
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
      derived = source.type === "mnemonic"
        ? await deriveZKasAccount(source.value, selection.accountIndex, selection.network)
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

  async selectedAddress(): Promise<(ZKasSelection & { address: string }) | null> {
    const keyring = ExtensionService.getInstance().getKeyring();
    if (!keyring.isUnlocked()) throw new Error("Unlock Kastle to read the ZKas address");
    const keyringVersion = keyring.getSessionVersion();
    const [walletSettings, settings, enabled] = await Promise.all([
      storage.getItem<WalletSettings>(WALLET_SETTINGS),
      storage.getItem<Settings>(SETTINGS_KEY),
      storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
    ]);
    if (!walletSettings || !settings || !getVisibleWalletNetworks(settings, enabled).includes(ZKAS_MAINNET)) {
      throw new Error("Enable Experimental features to read the ZKas address");
    }
    const secrets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
    const account = await getSelectedAvailableZKasAddress(walletSettings, secrets, async (source, index) => {
      await initZKasSigner(signerAssetUrl);
      const derived = source.type === "mnemonic"
        ? await deriveZKasAccount(source.value, index, "mainnet")
        : await deriveZKasAccountFromSeed(source.value, "mainnet");
      return derived.address;
    });
    const latestEnabled = await storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY);
    const latestSettings = await storage.getItem<Settings>(SETTINGS_KEY);
    const latestWalletSettings = await storage.getItem<WalletSettings>(WALLET_SETTINGS);
    if (!keyring.isUnlocked() || keyring.getSessionVersion() !== keyringVersion ||
      !latestSettings || !getVisibleWalletNetworks(latestSettings, latestEnabled).includes(ZKAS_MAINNET) ||
      latestWalletSettings?.selectedWalletId !== walletSettings.selectedWalletId ||
      latestWalletSettings?.selectedAccountIndex !== walletSettings.selectedAccountIndex) {
      throw new Error("ZKas account changed while reading the address");
    }
    return account;
  }

  async previewSeed(rawSeed: string): Promise<ZKasSelection & { address: string }> {
    const { selection, keyringVersion } = await this.selected();
    const keyring = ExtensionService.getInstance().getKeyring();
    const secrets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
    const secret = secrets.find((item) => item.id === selection.walletId);
    if (selection.accountIndex !== 0 || secret?.type !== "privateKey") {
      throw new Error("Select an imported-key wallet's account 0 to import a ZKas seed");
    }
    if (secret.zkasSeedHex) throw new Error("A ZKas seed is already attached to this wallet");
    const seedHex = normalizeZKasSeedHex(rawSeed);
    await initZKasSigner(signerAssetUrl);
    let address: string;
    try {
      address = (await deriveZKasAccountFromSeed(seedHex, selection.network)).address;
    } catch {
      throw new Error("Invalid ZKas spending seed");
    }
    await this.checkSelection(selection, undefined, keyringVersion);
    return { ...selection, address };
  }

  async importSeed(rawSeed: string, expectedAccount: ZKasSelection & { address: string }): Promise<ZKasSelection & { address: string }> {
    const preview = await this.previewSeed(rawSeed);
    if (!sameZKasSelection(preview, expectedAccount) || preview.address !== expectedAccount.address) {
      throw new Error("Selected ZKas account changed. Preview the seed again");
    }
    const { selection, keyringVersion } = await this.selected();
    if (!sameZKasSelection(preview, selection)) throw new Error("Selected ZKas account changed");
    if (await getZKasPaymentJournal().get(selection)) {
      throw new Error("Review the previous ZKas payment before importing a seed");
    }
    const keyring = ExtensionService.getInstance().getKeyring();
    await keyring.updateValue<WalletSecret[]>("wallets", async (secrets) => {
      const updated = attachZKasSeed(secrets ?? [], selection, rawSeed);
      await this.checkSelection(selection, undefined, keyringVersion);
      return updated;
    });
    return preview;
  }

  async credentials(): Promise<ZKasCredentials> {
    const { selection, settings, keyringVersion, derived } = await this.account();
    const fullViewingKeyHex = await derived.signer.fullViewingKeyHex();
    await this.checkSelection(selection, settings.zkasDaemonUrls?.[selection.network], keyringVersion);
    return {
      ...selection,
      keyringVersion,
      address: derived.address,
      fullViewingKeyHex,
      walletToken: derived.token,
      daemonUrl: settings.zkasDaemonUrls?.[selection.network],
    };
  }

  async sign(request: ZKasSignRequest): Promise<{ index: number; sig: string }[]> {
    await this.checkSelection(request.selection, request.daemonUrl, request.keyringVersion);
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
    const { derived, keyringVersion } = await this.account();
    if (keyringVersion !== request.keyringVersion) throw new Error("Kastle lock state changed during the ZKas request");
    await this.checkSelection(request.selection, request.daemonUrl, request.keyringVersion);
    const signatures = await derived.signer.verifyAndSign({
      network: request.selection.network,
      recipient: request.recipient,
      amountSompi,
      maxFeeSompi,
      bundleHex: request.bundleHex,
      disclosure: request.disclosure,
      spendAuth: request.spendAuth,
    });
    await this.checkSelection(request.selection, request.daemonUrl, request.keyringVersion);
    return signatures;
  }
}

export const zkasKeyService = new ZKasKeyService();
