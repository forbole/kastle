// Stubs for what WalletLockedAlert reaches into. Unhandled rejections are
// recorded on window.__walletLocked by main.tsx.

declare global {
  interface Window {
    __walletLocked: { rejections: string[] };
  }
}

// Chrome's own rejection on desktop Android (KASTLE-4T).
export const browser = {
  action: {
    openPopup: () =>
      Promise.reject(
        new Error("openPopup is not yet supported on desktop Android"),
      ),
  },
};

export const KEYRING_CHANGE_TIME = "keyringChangeTime";
export const useKeyring = () => ({
  getKeyringStatus: async () => ({ isUnlocked: false }),
});
export const useStorageState = <T>(_key: string, fallback: T) => [fallback];
