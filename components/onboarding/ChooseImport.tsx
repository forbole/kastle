import Header from "@/components/GeneralHeader.tsx";
import React from "react";
import { useFormContext } from "react-hook-form";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import useKeyring from "@/hooks/useKeyring.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { v4 as uuid } from "uuid";
import { useNavigate } from "react-router-dom";
import useWalletImporter from "@/hooks/wallet/useWalletImporter";

export default function ChooseImport() {
  const form = useFormContext<OnboardingData>();
  const navigate = useNavigate();
  const { keyringInitialize } = useKeyring();
  const { createNewWallet } = useWalletImporter();
  const password = form.watch("password");

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full w-full flex-col items-center px-10 py-4">
        <Header
          title="Import wallet with"
          onBack={() => form.setValue("step", "password")}
          showClose={false}
        />

        <div className="flex w-[16rem] flex-col items-center gap-4">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-4 rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
            onClick={() => form.setValue("step", "recovery-phrase")}
          >
            <span className="text-base">Recovery phrase</span>
            <i className="hn hn-arrow-right flex-none text-[14px]"></i>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-4 rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
            onClick={() => form.setValue("step", "private-key")}
          >
            <span className="text-base">Private key</span>
            <i className="hn hn-arrow-right flex-none text-[14px]"></i>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-4 rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
            onClick={() => form.setValue("step", "ledger")}
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
              navigate("/onboarding-success/create");
            }}
          >
            No wallet? Create one now
          </button>
        </div>
      </div>
    </div>
  );
}
