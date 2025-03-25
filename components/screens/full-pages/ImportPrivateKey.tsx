import React from "react";
import { useForm, useFormContext } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import useAnalytics from "@/hooks/useAnalytics.ts";
import { PrivateKey } from "@/wasm/core/kaspa";
import { useBoolean } from "usehooks-ts";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import Header from "@/components/GeneralHeader.tsx";

type PrivateKeyFormValues = { privateKey: string };

export default function ImportPrivateKey() {
  const { emitPrivateKeyImported } = useAnalytics();
  const navigate = useNavigate();
  const { keyringInitialize } = useKeyring();
  const { importPrivateKey } = useWalletManager();
  const onboardingForm = useFormContext<OnboardingData>();
  const {
    handleSubmit,
    register,
    formState: { isValid, errors },
    setValue,
  } = useForm<PrivateKeyFormValues>({
    mode: "all",
  });

  const { value: isHidden, toggle: toggleHidden } = useBoolean(true);

  const onClose = () => window.close();

  const readFromClipboard = async () => {
    const clipboardContents = await navigator.clipboard.read();
    const clipboardText = await clipboardContents?.[0].getType("text/plain");
    const clipboardString = await clipboardText.text();

    setValue("privateKey", clipboardString, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async ({ privateKey }) => {
    if (onboardingForm) {
      await keyringInitialize(onboardingForm.getValues("password"));
    }

    await importPrivateKey(uuid(), privateKey);

    emitPrivateKeyImported();
    navigate(onboardingForm ? "/onboarding-success" : "/accounts-imported");
  });

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <div className="flex h-full flex-col justify-stretch gap-6 text-white">
        <Header
          title="Import Private Key"
          subtitle="Please fill in the private key"
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
              <div className="flex justify-between">
                <button
                  type="button"
                  className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                  onClick={toggleHidden}
                >
                  <i className="hn hn-eye text-[14px]" />
                  <span>
                    {isHidden ? "Show private key" : "Hide private key"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={readFromClipboard}
                  className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                >
                  <span>Paste all</span>
                </button>
              </div>

              <textarea
                placeholder="Private key"
                {...register("privateKey", {
                  required: "Private key is required",
                  validate: (privateKey) => {
                    try {
                      new PrivateKey(privateKey);
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    } catch (_) {
                      return "Oh, the private key is invalid";
                    }

                    return undefined;
                  },
                })}
                className={twMerge(
                  "peer block h-[120px] w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-sm placeholder-daintree-200 hover:placeholder-daintree-50 focus:ring-0 disabled:pointer-events-none disabled:opacity-50",
                  errors.privateKey &&
                    "border-0 ring ring-red-500/25 focus:border-0 focus:ring focus:ring-red-500/25",
                  isHidden && "text-security-disc",
                )}
              />
            </div>
          </div>

          {errors.privateKey && (
            <span className="text-sm font-semibold text-red-500">
              {errors.privateKey.message}
            </span>
          )}

          <button
            type="submit"
            className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
            disabled={!isValid}
          >
            Import Wallet
          </button>
        </form>
      </div>
    </div>
  );
}
