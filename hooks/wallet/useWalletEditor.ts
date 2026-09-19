import internalToast from "@/components/Toast";
import useWalletManager from "./useWalletManager";
import useKeyring from "@/hooks/useKeyring";
import { defaultValue } from "@/contexts/WalletManagerContext";
import { removeWalletAndSecretLocked, WalletSecretCleanupError } from "@/lib/wallet-lifecycle";

export default function useWalletEditor() {
  const { walletSettings, setWalletSettings } = useWalletManager();
  const keyring = useKeyring();

  // Function to set legacy wallet enabled state
  const setLegacyWalletEnabled = async (walletId: string, enabled: boolean) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");

    const wallet = walletSettings.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    wallet.isLegacyWalletEnabled = enabled;
    await setWalletSettings({
      ...walletSettings,
    });
  };

  // Function to rename a wallet
  const renameWallet = async (walletId: string, newName: string) => {
    if (!walletSettings) {
      throw new Error("Wallet manager not initialized");
    }

    const wallet = walletSettings.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      return;
    }

    wallet.name = newName;

    await setWalletSettings({
      ...walletSettings,
      wallets: [...walletSettings.wallets],
    });
  };

  // Function to remove a wallet
  const removeWallet = async (walletId: string) => {
    try {
      return await removeWalletAndSecretLocked(
        walletId,
        defaultValue,
        (id) => keyring.removeWalletSecret({ walletId: id }),
        keyring.keyringReset,
      );
    } catch (error) {
      internalToast.error(error instanceof WalletSecretCleanupError ? error.message : "Failed to remove wallet");
      return { noWallet: false };
    }
  };

  return {
    setLegacyWalletEnabled,
    renameWallet,
    removeWallet,
  };
}
