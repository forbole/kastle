import type {
  Account,
  WalletInfo,
  WalletSettings,
} from "@/contexts/WalletManagerContext";

export function listKaspaWallets(wallets: WalletInfo[]): WalletInfo[] {
  return wallets.filter((wallet) => wallet.type !== "zkasSeed");
}

export function getSelectedKaspaAccount(
  settings: WalletSettings | null,
): Account | null {
  if (!settings) return null;
  const wallet = settings.wallets.find(
    (item) => item.id === settings.selectedWalletId,
  );
  if (!wallet || wallet.type === "zkasSeed") return null;
  return (
    wallet.accounts.find(
      (account) => account.index === settings.selectedAccountIndex,
    ) ?? null
  );
}

export async function runExclusiveWalletSelection(
  lock: { busy: boolean },
  select: () => Promise<void>,
  onBusyChange: (busy: boolean) => void,
): Promise<boolean> {
  if (lock.busy) return false;
  lock.busy = true;
  onBusyChange(true);
  try {
    await select();
    return true;
  } finally {
    lock.busy = false;
    onBusyChange(false);
  }
}
