// Stubs for what WalletLockedAlert reaches into. Unhandled rejections are
// recorded on window.__walletLocked by main.tsx.

declare global {
  interface Window {
    __walletLocked: {
      rejections: string[];
      // Outcome of each upcoming openPopup() call, consumed in order;
      // "reject" once the queue is empty; "hang" never settles.
      openPopup: ("resolve" | "reject" | "hang")[];
      openPopupCalls: number;
      // How long openPopup() takes to settle, to hold a call in flight.
      openPopupDelayMs: number;
    };
  }
}

// Chrome's own rejection on desktop Android (KASTLE-4T).
export const browser = {
  action: {
    openPopup: () => {
      const w = window.__walletLocked;
      w.openPopupCalls++;
      const outcome = w.openPopup.shift();
      if (outcome === "hang") return new Promise<void>(() => {});
      const ok = outcome === "resolve";
      return new Promise<void>((resolve, reject) =>
        setTimeout(
          () =>
            ok
              ? resolve()
              : reject(
                  new Error(
                    "openPopup is not yet supported on desktop Android",
                  ),
                ),
          w.openPopupDelayMs,
        ),
      );
    },
  },
};

export const KEYRING_CHANGE_TIME = "keyringChangeTime";
export const useKeyring = () => ({
  getKeyringStatus: async () => ({ isUnlocked: false }),
});
export const useStorageState = <T>(_key: string, fallback: T) => [fallback];
