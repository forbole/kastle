import useWalletManager from "@/hooks/useWalletManager.ts";

export default function useBackupWarning() {
  const { wallet } = useWalletManager();
  const { markWalletBacked } = useWalletManager();

  const disableWarning = (walletId: string) => markWalletBacked(walletId);

  return {
    showWarning: !wallet?.backed,
    disableWarning,
  };
}
