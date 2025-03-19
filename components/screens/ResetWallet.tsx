import React from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";

type ResetWalletFormValues = { agreedReset: boolean };

export default function ResetWallet() {
  const navigate = useNavigate();
  const { resetWallet } = useWalletManager();
  const {
    handleSubmit,
    register,
    formState: { isValid },
  } = useForm<ResetWalletFormValues>({ mode: "all" });

  const onClose = () => navigate("/dashboard");

  const onSubmit = handleSubmit(async ({ agreedReset }) => {
    if (agreedReset) {
      await resetWallet();
      navigate("/onboarding");
    }
  });

  return (
    <form className="flex h-full flex-col p-4 text-white" onSubmit={onSubmit}>
      <Header title="Forgot Password" />

      <div className="flex h-full flex-col items-stretch gap-4">
        <img
          src={warningImage}
          alt="Warning"
          className="mx-auto mb-6 h-20 w-20"
        />

        <p className="text-sm">
          To reset your password, you’ll need to{" "}
          <span className="text-red-500">reset your wallet</span> in this
          browser and <span className="text-red-500">import it again</span>{" "}
          using your recovery phrase.
        </p>

        <div
          className="mt-2 flex gap-2 rounded-lg border border-red-900 bg-red-800/10 p-4 text-red-500"
          role="alert"
          tabIndex={-1}
          aria-labelledby="hs-soft-color-danger-label"
        >
          <i className="hn hn-exclamation-triangle-solid text-[1rem] text-red-600"></i>
          <div>
            <span id="hs-soft-color-danger-label text-sm" className="font-bold">
              Before you proceed:
            </span>
            <ul className="list-disc text-xs">
              <li className="ml-4">
                Make sure you have your recovery phrase! It’s required to
                restore your wallet.
              </li>
              <li className="ml-4">
                Without it, you won’t be able to restore your wallet or access
                your funds.
              </li>
            </ul>
          </div>
        </div>

        <div className="flex">
          <input
            {...register("agreedReset", { required: true })}
            type="checkbox"
            className="mt-0.5 shrink-0 cursor-pointer rounded border-daintree-700 bg-icy-blue-950 text-icy-blue-400 checked:border-icy-blue-400 checked:bg-icy-blue-400 focus:ring-0 focus:ring-offset-0 disabled:pointer-events-none disabled:opacity-50"
            id="agreed-reset"
          />
          <label htmlFor="agreed-reset" className="ms-3 text-sm">
            I want to reset my wallet
          </label>
        </div>

        <div className="mt-auto flex items-center gap-4">
          <button
            type="button"
            className="inline-flex items-center gap-x-2 rounded-full border border-transparent p-5 text-sm font-medium text-neutral-400 hover:bg-icy-blue-600 focus:bg-neutral-800 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex flex-grow items-center justify-center gap-x-2 rounded-full border border-transparent bg-[#EF4444] p-5 text-sm font-semibold text-white hover:bg-[#DC2626] focus:bg-red-800/20 focus:outline-none disabled:pointer-events-none disabled:bg-red-800/30 disabled:text-red-800"
            disabled={!isValid}
          >
            Reset wallet
          </button>
        </div>
      </div>
    </form>
  );
}
