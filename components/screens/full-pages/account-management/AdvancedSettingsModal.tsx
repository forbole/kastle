import { twMerge } from "tailwind-merge";

type AdvancedSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  isLegacyWalletEnabled: boolean;
  toggleLegacyWallet: () => void;
};

export default function AdvancedSettingsModal({
  isOpen,
  onClose,
  isLegacyWalletEnabled,
  toggleLegacyWallet,
}: AdvancedSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Background Mask */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative max-h-[80vh] w-[500px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">
            Advanced Settings
          </h2>
          <button
            onClick={onClose}
            className="p-4 text-slate-400 transition-colors"
            type="button"
          >
            <i className="hn hn-x text-base" />
          </button>
        </div>

        {/* Settings */}
        <div className="space-y-6">
          {/* Legacy Wallet Toggle */}
          <div className="rounded-lg bg-slate-700 p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex-1">
                <h3 className="mb-2 font-medium text-white">
                  Switch to Kastle Legacy Wallet Addresses
                </h3>
                <p className="text-sm leading-relaxed text-slate-300">
                  Legacy Wallets addresses are derived using a different
                  derivation path. Enable this option if you need to recover
                  funds from wallets created in older Kastle versions.
                </p>
              </div>

              {/* Toggle Switch */}
              <div className="ml-4 flex-shrink-0">
                <button
                  onClick={() => toggleLegacyWallet()}
                  className={twMerge(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-800",
                    isLegacyWalletEnabled ? "bg-cyan-400" : "bg-slate-600",
                  )}
                  type="button"
                >
                  <span
                    className={twMerge(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      isLegacyWalletEnabled ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
