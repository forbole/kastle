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

      <div className="relative w-[45rem] overflow-hidden rounded-2xl bg-icy-blue-950 p-6 shadow-2xl">
        <div className="flex">
          <button
            className="ml-auto rounded-lg p-3 text-white hover:bg-gray-800"
            onClick={async () => {
              if (onClose) {
                await onClose();
              } else {
                window.close();
              }
            }}
          >
            <i className="hn hn-times flex items-center justify-center text-sm leading-none" />
          </button>
        </div>

        {/* Modal Title */}
        <div className="mb-4 flex">
          <h2 className="mx-auto text-xl font-semibold text-white">
            Advanced Settings
          </h2>
        </div>

        {/* Settings */}
        <div className="space-y-6">
          {/* Legacy Wallet Toggle */}
          <div className="rounded-lg border border-daintree-700 p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex-1">
                <h3 className="mb-2 text-base font-medium text-white">
                  Switch to Kastle Legacy Wallet Addresses
                </h3>
                <p className="text-sm leading-relaxed text-daintree-400">
                  Legacy Wallets addresses are derived using a different
                  derivation path. Enable this option if you need to recover
                  funds from wallets created in older Kastle versions.
                </p>
              </div>

              {/* Toggle Switch */}
              <div className="ml-4 flex-shrink-0">
                <input
                  onClick={(e) => {
                    toggleLegacyWallet();
                  }}
                  className={twMerge(
                    "relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-daintree-700 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-white before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-white focus:ring-transparent focus:ring-offset-transparent focus:checked:border-transparent disabled:pointer-events-none disabled:opacity-50",
                  )}
                  type="checkbox"
                  checked={isLegacyWalletEnabled}
                ></input>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
