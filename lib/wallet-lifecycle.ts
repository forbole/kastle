import type { WalletSettings } from "@/contexts/WalletManagerContext";
import {
  WALLET_SETTINGS_STORAGE_KEY,
  withWalletSettingsLock,
} from "@/lib/wallet-settings-storage";

export class WalletSecretCleanupError extends Error {
  constructor() {
    super(
      "Wallet removed from the list, but secret cleanup could not be confirmed. Reload Kastle and check your backup before importing again.",
    );
  }
}

export async function removeWalletAndSecretLocked(
  walletId: string,
  emptySettings: WalletSettings,
  removeSecret: (walletId: string) => Promise<void>,
  resetSecrets: () => Promise<void>,
): Promise<{ noWallet: boolean }> {
  return withWalletSettingsLock(async () => {
    const current = await storage.getItem<WalletSettings>(
      WALLET_SETTINGS_STORAGE_KEY,
    );
    if (!current) throw new Error("Wallet manager not initialized");
    if (!current.wallets.some((wallet) => wallet.id === walletId))
      throw new Error("Wallet not found");

    const wallets = current.wallets.filter((wallet) => wallet.id !== walletId);
    const noWallet = wallets.length === 0;
    const next: WalletSettings = noWallet
      ? emptySettings
      : {
          ...current,
          wallets,
          selectedWalletId:
            current.selectedWalletId === walletId
              ? wallets[0].id
              : current.selectedWalletId,
          selectedAccountIndex:
            current.selectedWalletId === walletId
              ? wallets[0].accounts[0]?.index
              : current.selectedAccountIndex,
        };

    // Remove public metadata first. A failed metadata write must never delete
    // the key. Once deletion starts, its result may be ambiguous, so never
    // restore metadata that could point at a missing key.
    await storage.setItem(WALLET_SETTINGS_STORAGE_KEY, next);
    const deleteSecret = () =>
      noWallet ? resetSecrets() : removeSecret(walletId);
    try {
      await deleteSecret();
    } catch {
      try {
        // Both keyring operations are idempotent. A retry also resolves a
        // lost response after the first deletion committed.
        await deleteSecret();
      } catch {
        throw new WalletSecretCleanupError();
      }
    }
    return { noWallet };
  });
}
