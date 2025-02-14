import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import useAnalytics from "@/hooks/useAnalytics.ts";

type PrivateKeyFormValues = { privateKey: string };

export default function ImportPrivateKey() {
  const { emitPrivateKeyImported } = useAnalytics();
  const navigate = useNavigate();
  const { importPrivateKey } = useWalletManager();
  const {
    handleSubmit,
    register,
    formState: { isValid, dirtyFields },
    setValue,
  } = useForm<PrivateKeyFormValues>();
  const isDirtyAlt = !!Object.keys(dirtyFields).length;

  const [isHidden, setIsHidden] = useState(true);

  const onClose = () => window.close();

  const readFromClipboard = async () => {
    const clipboardContents = await navigator.clipboard.read();
    const clipboardText = await clipboardContents?.[0].getType("text/plain");
    const clipboardString = await clipboardText.text();

    setValue("privateKey", clipboardString, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async ({ privateKey }) => {
    await importPrivateKey(uuid(), privateKey);

    emitPrivateKeyImported();
    navigate("/accounts-imported");
  });

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <div className="flex h-full flex-col justify-stretch gap-6 text-white">
        <div className="flex justify-between">
          {/* Placeholder */}
          <div
            onClick={onClose}
            className="flex h-12 w-12 items-center justify-center"
          ></div>

          <div className="text-center">
            <h1 className="text-xl font-bold">Import Private Key</h1>
            <span className="text-xs text-daintree-400">
              Please fill in the private key
            </span>
          </div>

          <button
            onClick={onClose}
            className="flex h-12 w-12 items-center justify-center"
          >
            <i className="hn hn-times text-xl"></i>
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-grow flex-col items-stretch gap-4"
        >
          <div className="relative">
            <div className={twMerge("flex flex-col gap-4", isHidden && "blur")}>
              <div className="flex justify-between">
                <button
                  type="button"
                  className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => setIsHidden(true)}
                >
                  <i className="hn hn-eye text-[14px]" />
                  <span>Hide private key</span>
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
                })}
                className={twMerge(
                  "peer block h-[120px] w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-sm text-daintree-400 focus:ring-0 disabled:pointer-events-none disabled:opacity-50",
                  !isValid && isDirtyAlt && "ring ring-red-500/25",
                  isHidden && "blur",
                )}
              />
            </div>
            {isHidden && (
              <button
                type="button"
                onClick={() => setIsHidden(false)}
                className="absolute inset-0 flex flex-col items-center justify-center gap-4"
              >
                <i className="hn hn-eye-cross text-[46px]"></i>
                <span className="text-base text-[#C8C3C0]">
                  Make sure no one is looking your screen
                </span>
              </button>
            )}
          </div>

          {!isValid && isDirtyAlt && (
            <span className="text-sm font-semibold text-red-500">
              Oh, invalid
            </span>
          )}

          <button
            type="submit"
            className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-[#125F78] disabled:bg-daintree-800 disabled:text-[#4B5563]"
            disabled={!isValid}
          >
            Import Wallet
          </button>
        </form>
      </div>
    </div>
  );
}
