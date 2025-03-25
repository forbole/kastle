import Header from "@/components/GeneralHeader.tsx";
import React from "react";
import { useFormContext } from "react-hook-form";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import useKeyring from "@/hooks/useKeyring.ts";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { v4 as uuid } from "uuid";

export default function ChooseImport() {
  const form = useFormContext<OnboardingData>();
  const { keyringInitialize } = useKeyring();
  const { createNewWallet } = useWalletManager();
  const password = form.watch("password");

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full w-full flex-col items-center p-4">
        <Header
          title="Import wallet with"
          onBack={() => form.setValue("step", "password")}
          showClose={false}
        />

        <div className="flex w-[16rem] flex-col items-center gap-4">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-4 rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          >
            <span className="text-base">Recovery phrase</span>
            <i className="hn hn-arrow-right flex-none text-[14px]"></i>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-4 rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          >
            <span className="text-base">Private key</span>
            <i className="hn hn-arrow-right flex-none text-[14px]"></i>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-4 rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          >
            <span className="text-base">Ledger</span>
            <i className="hn hn-arrow-right flex-none text-[14px]"></i>
          </button>
          <button
            type="button"
            className="mt-14 p-4 text-base font-semibold text-white"
            onClick={async () => {
              await keyringInitialize(password);
              await createNewWallet(uuid());
              form.setValue("step", "success");
            }}
          >
            No wallet? Create one now
          </button>
        </div>
      </div>
    </div>
  );
}
