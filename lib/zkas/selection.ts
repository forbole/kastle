import type { Settings } from "@/contexts/SettingsContext";
import type { WalletSettings } from "@/contexts/WalletManagerContext";
import type { WalletSecret } from "@/types/WalletSecret";
import type { ZKasNetwork } from "./client";
import { isZKasActive } from "@/lib/wallet-network";

export type ZKasSelection = {
  walletId: string;
  accountIndex: number;
  network: ZKasNetwork;
};

export async function loadSelectedZKasAccount(
  keyring: { isUnlocked(): boolean; getSessionVersion(): number },
  readWalletSettings: () => Promise<WalletSettings | null>,
  readSettings: () => Promise<Settings | null>,
  readExperimentalEnabled: () => Promise<boolean | null>,
): Promise<{ selection: ZKasSelection; settings: Settings; keyringVersion: number }> {
  if (!keyring.isUnlocked()) throw new Error("Unlock Kastle to use ZKas");
  const keyringVersion = keyring.getSessionVersion();
  const [walletSettings, settings, experimentalEnabled] = await Promise.all([
    readWalletSettings(), readSettings(), readExperimentalEnabled(),
  ]);
  if (!settings) throw new Error("Kastle settings are unavailable");
  const selection = getSelectedZKasAccount(walletSettings, settings, experimentalEnabled);
  if (!keyring.isUnlocked() || keyring.getSessionVersion() !== keyringVersion) {
    throw new Error("Kastle was locked during the ZKas request");
  }
  return { selection, settings, keyringVersion };
}

export function getSelectedZKasAccount(
  walletSettings: WalletSettings | null,
  settings: Settings | null,
  experimentalEnabled: boolean | null,
): ZKasSelection {
  if (!isZKasActive(settings, experimentalEnabled)) {
    throw new Error("Enable Experimental features and select ZKas Mainnet first");
  }
  if (!walletSettings?.selectedWalletId || walletSettings.selectedAccountIndex === undefined) {
    throw new Error("Select a Kastle wallet account first");
  }
  const wallet = walletSettings.wallets.find((item) => item.id === walletSettings.selectedWalletId);
  const accountIndex = walletSettings.selectedAccountIndex;
  if (!wallet || !wallet.accounts.some((item) => item.index === accountIndex)) {
    throw new Error("Selected Kastle account was not found");
  }
  if (wallet.type !== "mnemonic") {
    throw new Error("ZKas is not supported for this wallet type");
  }
  return { walletId: wallet.id, accountIndex, network: "mainnet" };
}

export function getZKasMnemonic(
  walletSecrets: WalletSecret[],
  selection: ZKasSelection,
): string {
  const secret = walletSecrets.find((item) => item.id === selection.walletId);
  if (!secret) throw new Error("Selected wallet secret was not found");
  if (secret.type !== "mnemonic" || secret.passphrase) {
    throw new Error("ZKas is not supported for this wallet type or passphrase");
  }
  return secret.value;
}

export function sameZKasSelection(a: ZKasSelection, b: ZKasSelection): boolean {
  return a.walletId === b.walletId &&
    a.accountIndex === b.accountIndex &&
    a.network === b.network;
}
