import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";

type RemoveWalletFormValues = { agreedRemove: boolean };

export default function RemoveWallet() {
  const navigate = useNavigate();
  const { walletId } = useParams();
  const { removeWallet } = useWalletManager();
  const {
    handleSubmit,
    register,
    formState: { isValid },
  } = useForm<RemoveWalletFormValues>({ mode: "all" });

  const onClose = () => navigate("/dashboard");

  const onSubmit = handleSubmit(async ({ agreedRemove }) => {
    if (agreedRemove && !!walletId) {
      const { noWallet } = await removeWallet(walletId);

      navigate(noWallet ? "/onboarding" : "/dashboard");
    }
  });

  return (
    <div className="flex h-full flex-col p-4">
      <Header title="Remove wallet" />
      <form className="flex flex-grow flex-col gap-6" onSubmit={onSubmit}>
        <div className="flex h-full flex-col items-stretch justify-center gap-6">
          <img
            alt="warning"
            className="h-24 w-24 self-center"
            src={warningImage}
          />

          <p className="text-center text-sm">
            Are you sure you want to{" "}
            <span className="text-red-500">remove your wallet</span>?<br /> To
            access it in the future, you will need to import it again.
          </p>

          <div
            className="flex gap-2 rounded-lg border border-red-900 bg-red-800/30 p-4 text-red-500"
            role="alert"
            tabIndex={-1}
            aria-labelledby="hs-soft-color-danger-label"
          >
            <i className="hn hn-exclamation-triangle-solid pt-1 text-red-600"></i>
            <div>
              <span
                id="hs-soft-color-danger-label"
                className="text-sm font-bold"
              >
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

          <div className="flex px-2">
            <input
              {...register("agreedRemove", { required: true })}
              type="checkbox"
              className="mt-0.5 shrink-0 rounded border-neutral-700 bg-daintree-700 text-blue-600 checked:border-icy-blue-400 checked:bg-icy-blue-400 focus:ring-blue-500 focus:ring-offset-gray-800 disabled:pointer-events-none disabled:opacity-50"
              id="agreed-reset"
            />
            <label
              htmlFor="agreed-reset"
              className="ms-3 text-sm text-gray-200"
            >
              I want to remove my wallet
            </label>
          </div>

          <div className="mt-auto flex items-center gap-4">
            <button
              type="button"
              className="inline-flex items-center gap-x-2 rounded-full border border-transparent p-5 text-sm font-medium text-neutral-400 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex flex-grow items-center justify-center gap-x-2 rounded-full border border-transparent bg-red-500 p-5 text-sm font-semibold text-white hover:bg-red-500 focus:bg-red-800/20 focus:outline-none disabled:pointer-events-none disabled:bg-red-800/30 disabled:text-red-800"
              disabled={!isValid}
            >
              Remove wallet
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
