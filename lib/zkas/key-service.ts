import type { Settings } from "@/contexts/SettingsContext";
import { SETTINGS_KEY } from "@/contexts/SettingsContext";
import type { WalletSettings } from "@/contexts/WalletManagerContext";
import { WALLET_SETTINGS } from "@/contexts/WalletManagerContext";
import { ExtensionService } from "@/lib/service/extension-service";
import type { WalletSecret } from "@/types/WalletSecret";
import signerAssetUrl from "@/wasm/zkas-signer/firecash_signer_bg.wasm?url";
import { parseZkasSompi } from "./amount";
import { deriveZKasAccount, initZKasSigner } from "./signer";
import { getZKasMnemonic, loadSelectedZKasAccount, sameZKasSelection, type ZKasSelection } from "./selection";

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
    const mnemonic = getZKasMnemonic(secrets, selection);
    await initZKasSigner(signerAssetUrl);
    let derived: Awaited<ReturnType<typeof deriveZKasAccount>>;
    try {
      derived = await deriveZKasAccount(mnemonic, selection.accountIndex, selection.network);
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
