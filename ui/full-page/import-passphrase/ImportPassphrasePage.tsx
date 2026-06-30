import { useState } from "react";
import PageHeader from "@/ui/general/PageHeader";

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

function PassphraseInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div className="relative w-full max-w-[390px] rounded-2xl bg-icy-blue-950 p-10">
        <button
          className="absolute right-2.5 top-2.5 flex size-[38px] items-center justify-center rounded-lg text-daintree-400 hover:bg-daintree-800"
          onClick={onClose}
          type="button"
        >
          <i className="hn hn-times text-sm" />
        </button>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <h2 className="text-center text-xl font-bold tracking-[0.1px] text-gray-200">
              What is a passphrase?
            </h2>
            <div className="text-sm leading-5 tracking-[0.07px] text-daintree-400">
              <p>{`An optional "25th word" added to your recovery phrase. Each passphrase opens a different wallet.`}</p>
              <p className="mt-4 font-semibold text-gray-200">Use this if:</p>
              <ul className="mt-1 list-disc pl-5">
                <li>
                  You created your wallet with a passphrase on another app
                </li>
                <li>{`You're importing a hidden wallet`}</li>
              </ul>
              <p className="mt-4">
                <span className="font-semibold text-gray-200">{`Skip this if you're unsure`}</span>
                {` — use "Recovery Phrase or Private Key" instead.`}
              </p>
              <p className="mt-4 font-semibold text-gray-200">⚠️ Important:</p>
              <ul className="mt-1 list-disc pl-5">
                <li>
                  Kastle never stores your passphrase — lose it, lose access
                  forever
                </li>
                <li>
                  A wrong passphrase silently opens a different wallet (no error
                  shown)
                </li>
                <li>{`Case-sensitive: "Hello" ≠ "hello"`}</li>
              </ul>
            </div>
          </div>

          <button
            className="w-full rounded-full border border-daintree-400 py-3.5 text-[15px] font-semibold tracking-[0.075px] text-[#c1d5de] hover:bg-daintree-800"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
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
    <div className="flex h-full w-full items-start justify-center bg-icy-blue-900 py-6">
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
            showBack
            showClose={false}
            subtitle={subtitle}
            title={title}
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
