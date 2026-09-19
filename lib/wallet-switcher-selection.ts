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
