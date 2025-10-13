import internalToast from "@/components/Toast";
import useWalletManager from "./useWalletManager";
import useKeyring from "@/hooks/useKeyring";

export default function useWalletEditor() {
  const { walletSettings, setWalletSettings, resetWallet } = useWalletManager();
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
      if (!walletSettings) {
        throw new Error("Wallet manager not initialized");
      }

      walletSettings.wallets = walletSettings.wallets.filter(
        (w) => w.id !== walletId,
      );

      const noWallet = walletSettings.wallets.length === 0;

      if (noWallet) {
        await resetWallet();
        return { noWallet: noWallet };
      }

      await keyring.removeWalletSecret({ walletId });

      // If the wallet being removed is the selected wallet, select the first account of the first wallet
      if (walletSettings.selectedWalletId === walletId) {
        walletSettings.selectedWalletId = walletSettings.wallets[0]?.id;
        walletSettings.selectedAccountIndex =
          walletSettings.wallets[0]?.accounts[0]?.index;
      }

      await setWalletSettings(walletSettings);

      return { noWallet: noWallet };
    } catch (error) {
      internalToast.error("Failed to remove wallet");
    }
  };

  return {
    setLegacyWalletEnabled,
    renameWallet,
    removeWallet,
  };
}
