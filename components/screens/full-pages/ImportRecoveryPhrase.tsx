import { useNavigate } from "react-router-dom";
import React, { useState } from "react";
import { useForm, useFormContext } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { v4 as uuid } from "uuid";
import useAnalytics from "@/hooks/useAnalytics.ts";
import { Mnemonic } from "@/wasm/core/kaspa";
import { useBoolean } from "usehooks-ts";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import useKeyring from "@/hooks/useKeyring.ts";
import Header from "@/components/GeneralHeader.tsx";

type PhraseLength = 12 | 24;

type WordNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

type SeedPhraseFormValues = {
  [K in `word${WordNumber}`]: string;
};

export default function ImportRecoveryPhrase() {
  const { emitWalletImported } = useAnalytics();
  const navigate = useNavigate();
  const { keyringInitialize } = useKeyring();
  const { importWalletByMnemonic } = useWalletManager();
  const onboardingForm = useFormContext<OnboardingData>();
  const {
    register,
    formState: { isValid, dirtyFields },
    watch,
    setValue,
    handleSubmit,
  } = useForm<SeedPhraseFormValues>({
    mode: "all",
  });
  const isDirtyAlt = !!Object.keys(dirtyFields).length;
  const inputWords = watch();

  const [recoveryPhraseError, setRecoveryPhraseError] = useState<string>();
  const [phraseLength, setPhraseLength] = useState<PhraseLength>(12);
  const { value: isHidden, toggle: toggleHidden } = useBoolean(true);

  const onClose = () => window.close();

  const setWords = (words: string) => {
    const wordsArray = words.split(/[\s\n]+/);

    if (![12, 24].includes(wordsArray.length)) {
      return;
    }

    setPhraseLength(wordsArray.length as PhraseLength);

    wordsArray.forEach((word, index) => {
      setValue(`word${(index + 1) as WordNumber}`, word, {
        shouldValidate: true,
      });
    });
  };

  const joinRecoveryPhrase = () => {
    const words: string[] = [];
    for (let index = 0; index < phraseLength; index++) {
      words.push(inputWords[`word${index + 1}` as `word${WordNumber}`]);
    }

    return words.join(" ");
  };

  const readFromClipboard = async () => {
    const clipboardContents = await navigator.clipboard.read();
    const clipboardText = await clipboardContents?.[0].getType("text/plain");
    const words = await clipboardText.text();
    setWords(words);
  };

  const onSubmit = handleSubmit(async (data) => {
    const words: string[] = [];
    for (let index = 0; index < phraseLength; index++) {
      words.push(data[`word${index + 1}` as `word${WordNumber}`]);
    }

    if (onboardingForm) {
      await keyringInitialize(onboardingForm.getValues("password"));
    }

    const walletId = uuid();
    await importWalletByMnemonic(walletId, words.join(" "));

    emitWalletImported();
    navigate(`/manage-accounts/recovery-phrase/${walletId}/import`, {
      state: {
        ...(onboardingForm && { redirect: "/onboarding-success/import" }),
      },
    });
  });

  const pasteAllInCell = (str: string) => {
    const isPhraseComplete = /^\s*(?:\S+\s+){11}|(?:\S+\s+){23}\S+\s*$/.test(
      str,
    );

    if (isPhraseComplete) {
      setWords(str);
    }
  };

  useEffect(() => {
    try {
      new Mnemonic(joinRecoveryPhrase());

      setRecoveryPhraseError(undefined);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_) {
      setRecoveryPhraseError("Oh, the recovery phrase is invalid");
    }
  }, [inputWords]);

  return (
    <div className="flex h-[56rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full flex-col justify-stretch gap-6 px-10 py-4 pb-6 text-white">
        <Header
          title="Import Recovery Phrase"
          subtitle="Please fill in the recovery phrase"
          showPrevious={!!onboardingForm}
          onBack={() => onboardingForm.setValue("step", "choose")}
          showClose={!onboardingForm}
          onClose={onClose}
        />

        <form
          onSubmit={onSubmit}
          className="flex flex-grow flex-col items-stretch gap-4"
        >
          <div className="relative">
            <div className="flex flex-col gap-4">
              {/* Word length switcher */}
              <nav className="flex gap-x-2 rounded-xl bg-daintree-800 p-1">
                <button
                  type="button"
                  onClick={() => setPhraseLength(12)}
                  className={twMerge(
                    "inline-flex flex-grow items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-daintree-200 focus:outline-none",
                    phraseLength === 12 ? "bg-daintree-700" : "bg-transparent",
                  )}
                >
                  12 Words
                </button>
                <button
                  type="button"
                  onClick={() => setPhraseLength(24)}
                  className={twMerge(
                    "inline-flex flex-grow items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-daintree-200 focus:outline-none",
                    phraseLength === 24 ? "bg-daintree-700" : "bg-transparent",
                  )}
                >
                  24 Words
                </button>
              </nav>

              <div className="flex justify-between">
                <button
                  type="button"
                  className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                  onClick={toggleHidden}
                >
                  <i className="hn hn-eye text-[14px]" />
                  <span>{isHidden ? "Show words" : "Hide words"}</span>
                </button>
                <button
                  onClick={readFromClipboard}
                  type="button"
                  className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                >
                  <span>Paste all</span>
                </button>
              </div>

              {/* Word grid */}
              <div className="grid grid-cols-3 gap-4">
                {[...Array(phraseLength)].map((_, index) => (
                  <div key={index} className="relative">
                    <input
                      {...register(
                        `word${index + 1}` as keyof SeedPhraseFormValues,
                        {
                          onChange: (event) =>
                            pasteAllInCell(event.target.value as string),
                          required: "Word is required",
                        },
                      )}
                      type={isHidden ? "password" : "text"}
                      autoComplete="off"
                      className={twMerge(
                        "peer block w-full rounded-lg border border-daintree-700 bg-daintree-800 py-3 pe-0 text-base text-white focus:ring-0 disabled:pointer-events-none",
                        !isValid && isDirtyAlt && "ring ring-red-500/25",
                        index >= 9 ? "ps-8" : "ps-7",
                      )}
                    />
                    <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2 text-base text-[#7B9AAA] peer-disabled:pointer-events-none">
                      {index + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {(!isValid || recoveryPhraseError) && isDirtyAlt && (
            <span className="text-sm font-semibold text-red-500">
              {recoveryPhraseError ? recoveryPhraseError : "Oh, invalid"}
            </span>
          )}

          <button
            type="submit"
            className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
            disabled={!isValid || !!recoveryPhraseError}
          >
            Import Wallet
          </button>
        </form>
      </div>
    </div>
  );
}
