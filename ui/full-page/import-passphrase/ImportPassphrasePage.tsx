import { useState } from "react";
import PageHeader from "@/ui/general/PageHeader";
import PassphraseInfoModal from "@/ui/general/PassphraseInfoModal";

export interface ImportPassphrasePageProps {
  title?: string;
  subtitle?: string;
  passphraseLabel?: string;
  passphrasePlaceholder?: string;
  passphraseInfoLabel?: string;
  buttonLabel?: string;
  isLoading?: boolean;
  error?: string;
  onBack?: () => void;
  onSubmit?: (passphrase: string) => void;
}

export default function ImportPassphrasePage({
  title = "Import Passphrase",
  subtitle = "Enter your passphrase",
  passphraseLabel = "Passphrase",
  passphrasePlaceholder = "Enter your passphrase",
  passphraseInfoLabel = "What is a passphrase?",
  buttonLabel = "Next",
  isLoading = false,
  error,
  onBack,
  onSubmit,
}: ImportPassphrasePageProps) {
  const [passphrase, setPassphrase] = useState("");
  const [isHidden, setIsHidden] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const disabled = !passphrase || isLoading;

  return (
    <div className="flex w-full items-start justify-center bg-icy-blue-900">
      <div
        className="relative flex w-[624px] flex-col justify-between overflow-clip rounded-3xl bg-icy-blue-950"
        style={{ minHeight: 794 }}
      >
        {showModal && (
          <PassphraseInfoModal onClose={() => setShowModal(false)} />
        )}

        <div className="flex flex-col gap-4">
          <PageHeader
            onBack={onBack}
            paddingX="px-8"
            showBack
            showClose={false}
            subtitle={subtitle}
            title={title}
            paddingBottom="pb-4"
          />

          <div className="flex flex-col gap-6 px-10">
            <div className="flex flex-col gap-4">
              <label className="text-base font-semibold tracking-[0.08px] text-gray-200">
                {passphraseLabel}
              </label>
              <div className="relative">
                <input
                  className="w-full rounded-lg bg-daintree-800 py-3.5 pl-4 pr-12 text-[15px] font-medium text-white placeholder-daintree-400 shadow-sm focus:outline-none focus:ring-0"
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={passphrasePlaceholder}
                  type={isHidden ? "password" : "text"}
                  value={passphrase}
                />
                <button
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-daintree-400"
                  onClick={() => setIsHidden((v) => !v)}
                  type="button"
                >
                  <i
                    className={`hn ${isHidden ? "hn-eye-cross" : "hn-eye"} text-base`}
                  />
                </button>
              </div>
              {error && (
                <span className="text-sm font-semibold text-red-500">
                  {error}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bottom */}
        <div className="flex flex-col gap-3 px-10 py-6">
          <button
            className="inline-flex items-center justify-center gap-2 py-4 text-sm font-medium text-icy-blue-400"
            onClick={() => setShowModal(true)}
            type="button"
          >
            <i className="hn hn-info-circle text-base" />
            {passphraseInfoLabel}
          </button>
          <button
            className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-daintree-600"
            disabled={disabled}
            onClick={() => !disabled && onSubmit?.(passphrase)}
            type="button"
          >
            {isLoading ? (
              <i className="hn hn-spinner animate-spin text-xl" />
            ) : (
              buttonLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
