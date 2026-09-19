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

export async function getSelectedAvailableZKasAddress(
  walletSettings: WalletSettings,
  walletSecrets: WalletSecret[],
  deriveAddress: (source: { type: "mnemonic" | "seed"; value: string }, accountIndex: number) => Promise<string>,
): Promise<(ZKasSelection & { address: string }) | null> {
  const wallet = walletSettings.wallets.find((item) => item.id === walletSettings.selectedWalletId);
  const account = wallet?.accounts.find((item) => item.index === walletSettings.selectedAccountIndex);
  if (!wallet || !account) return null;
  const secret = walletSecrets.find((item) => item.id === wallet.id);
  if (!secret || secret.type !== wallet.type) return null;
  let source: { type: "mnemonic" | "seed"; value: string };
  if (secret.type === "mnemonic" && !secret.passphrase) {
    source = { type: "mnemonic", value: secret.value };
  } else if (secret.type === "privateKey" && account.index === 0 && secret.zkasSeedHex) {
    source = { type: "seed", value: normalizeZKasSeedHex(secret.zkasSeedHex) };
  } else {
    return null;
  }
  const address = await deriveAddress(source, account.index);
  return { walletId: wallet.id, accountIndex: account.index, network: "mainnet", address };
}

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
  return { walletId: wallet.id, accountIndex, network: "mainnet" };
}

export function normalizeZKasSeedHex(value: string): string {
  const seed = typeof value === "string" ? value.trim().replace(/^0x/i, "") : "";
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error("ZKas spending seed must be 32 bytes (64 hexadecimal characters)");
  }
  return seed.toLowerCase();
}

export function attachZKasSeed(
  walletSecrets: WalletSecret[],
  selection: ZKasSelection,
  rawSeed: string,
): WalletSecret[] {
  const seed = normalizeZKasSeedHex(rawSeed);
  if (selection.accountIndex !== 0) throw new Error("Imported-key wallets support only account 0");
  const index = walletSecrets.findIndex((item) => item.id === selection.walletId);
  if (index < 0) throw new Error("Selected wallet secret was not found");
  const secret = walletSecrets[index];
  if (secret.type !== "privateKey") throw new Error("ZKas seed import requires an imported-key wallet");
  if (secret.zkasSeedHex) throw new Error("A ZKas seed is already attached to this wallet");
  return walletSecrets.map((item, itemIndex) => itemIndex === index ? { ...item, zkasSeedHex: seed } : item);
}

export function getZKasSecretSource(
  walletSecrets: WalletSecret[],
  selection: ZKasSelection,
): { type: "mnemonic" | "seed"; value: string } {
  const secret = walletSecrets.find((item) => item.id === selection.walletId);
  if (!secret) throw new Error("Selected wallet secret was not found");
  if (secret.type === "privateKey") {
    if (selection.accountIndex !== 0) throw new Error("Imported-key wallets support only account 0");
    if (!secret.zkasSeedHex) throw new Error("Import a ZKas spending seed for this wallet first");
    return { type: "seed", value: normalizeZKasSeedHex(secret.zkasSeedHex) };
  }
  return { type: "mnemonic", value: getZKasMnemonic(walletSecrets, selection) };
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

export function requireSelectedZKasAddress<T extends ZKasSelection & { address: string }>(
  account: T | null,
  expected: ZKasSelection,
): T | null {
  if (account && !sameZKasSelection(account, expected)) {
    throw new Error("Selected ZKas account changed. Refresh this screen.");
  }
  return account;
}
