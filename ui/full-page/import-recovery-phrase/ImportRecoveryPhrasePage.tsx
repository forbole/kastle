import { useState } from "react";
import { twMerge } from "tailwind-merge";
import PageHeader from "@/ui/general/PageHeader";
import PassphraseInfoModal from "@/ui/general/PassphraseInfoModal";

type PhraseLength = 12 | 24;

export interface ImportRecoveryPhrasePageProps {
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  passphraseInfoLabel?: string;
  hasPassphrase?: boolean;
  isLoading?: boolean;
  error?: string;
  onBack?: () => void;
  onErrorClear?: () => void;
  onSubmit?: (words: string[], phraseLength: PhraseLength) => void;
}

export default function ImportRecoveryPhrasePage({
  title = "Recovery phrase with passphrase",
  subtitle = "Please fill in the recovery phrase",
  buttonLabel = "Import Wallet",
  passphraseInfoLabel = "What is a passphrase?",
  hasPassphrase = true,
  isLoading = false,
  error,
  onBack,
  onErrorClear,
  onSubmit,
}: ImportRecoveryPhrasePageProps) {
  const [phraseLength, setPhraseLength] = useState<PhraseLength>(12);
  const [words, setWords] = useState<string[]>(Array(24).fill(""));
  const [isHidden, setIsHidden] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const setWord = (index: number, value: string) => {
    onErrorClear?.();
    setWords((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handlePaste = (
    index: number,
    e: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    const text = e.clipboardData.getData("text");
    const parsed = text.trim().split(/\s+/);
    if (parsed.length <= 1) return;
    e.preventDefault();
    onErrorClear?.();
    const newLen =
      parsed.length >= 24 ? 24 : parsed.length >= 12 ? 12 : phraseLength;
    setWords((prev) => {
      const next = [...prev];
      parsed.forEach((word, i) => {
        if (index + i < 24) next[index + i] = word;
      });
      return next;
    });
    if (index === 0) setPhraseLength(newLen as PhraseLength);
  };

  const handlePasteAll = async () => {
    const text = await navigator.clipboard.readText().catch(() => null);
    if (!text) return;
    const parsed = text.trim().split(/\s+/);
    if (parsed.length === 12 || parsed.length === 24) {
      onErrorClear?.();
      setPhraseLength(parsed.length as PhraseLength);
      setWords([...parsed, ...Array(24 - parsed.length).fill("")]);
    }
  };

  const currentWords = words.slice(0, phraseLength);
  const allFilled = currentWords.every((w) => w.trim().length > 0);
  const disabled = !allFilled || !!error || isLoading;

  return (
    <div className="flex w-full items-start justify-center bg-icy-blue-900">
      <div
        className="relative flex w-[624px] flex-col justify-between overflow-clip rounded-3xl bg-icy-blue-950"
        style={{ minHeight: 794 }}
      >
        {showModal && (
          <PassphraseInfoModal onClose={() => setShowModal(false)} />
        )}

        <div className="flex flex-col">
          <PageHeader
            onBack={onBack}
            paddingX="px-8"
            showBack
            showClose={false}
            subtitle={subtitle}
            title={title}
            paddingBottom="pb-4"
          />

          <div className="flex flex-col gap-4 px-10">
            {/* Tab switcher */}
            <nav className="flex gap-x-2 rounded-xl bg-daintree-800 p-1">
              {([12, 24] as PhraseLength[]).map((len) => (
                <button
                  className={twMerge(
                    "inline-flex flex-grow items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-daintree-200 focus:outline-none",
                    phraseLength === len ? "bg-daintree-700" : "bg-transparent",
                  )}
                  key={len}
                  onClick={() => setPhraseLength(len)}
                  type="button"
                >
                  {len} Words
                </button>
              ))}
            </nav>

            {/* Hide / Paste all */}
            <div className="flex justify-between">
              <button
                className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700"
                onClick={() => setIsHidden((v) => !v)}
                type="button"
              >
                <i
                  className={`hn ${isHidden ? "hn-eye" : "hn-eye-cross"} text-[14px]`}
                />
                <span>{isHidden ? "Show words" : "Hide words"}</span>
              </button>
              <button
                className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700"
                onClick={handlePasteAll}
                type="button"
              >
                Paste all
              </button>
            </div>

            {/* Word grid */}
            <div className="grid grid-cols-3 gap-4">
              {currentWords.map((word, index) => (
                <div className="relative" key={index}>
                  <input
                    autoComplete="off"
                    className={twMerge(
                      "peer block w-full rounded-lg border border-daintree-700 bg-daintree-800 py-3 pe-0 text-base text-white focus:ring-0",
                      index >= 9 ? "ps-8" : "ps-7",
                    )}
                    onChange={(e) => setWord(index, e.target.value)}
                    onPaste={(e) => handlePaste(index, e)}
                    type={isHidden ? "password" : "text"}
                    value={word}
                  />
                  <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2 text-base text-[#7B9AAA]">
                    {index + 1}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <span className="text-sm font-semibold text-red-500">
                {error}
              </span>
            )}
          </div>
        </div>

        {/* Bottom */}
        <div className="flex flex-col gap-3 px-4 py-6">
          {hasPassphrase && (
            <button
              className="inline-flex items-center justify-center gap-2 py-4 text-sm font-medium text-icy-blue-400"
              onClick={() => setShowModal(true)}
              type="button"
            >
              <i className="hn hn-info-circle text-base" />
              {passphraseInfoLabel}
            </button>
          )}
          <button
            className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
            disabled={disabled}
            onClick={() => !disabled && onSubmit?.(currentWords, phraseLength)}
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
