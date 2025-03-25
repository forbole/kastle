import React, { useEffect } from "react";
import confetti from "canvas-confetti";
import Header from "@/components/GeneralHeader.tsx";
import successImage from "@/assets/images/success.png";
import useExtensionUtils from "@/hooks/useExtensionUtils.ts";

export default function OnboardingSuccess() {
  const calledOnce = useRef(false);
  const { emitOnboardingComplete } = useAnalytics();
  const { reopenPopup } = useExtensionUtils();

  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    emitOnboardingComplete();
  }, []);

  useEffect(() => {
    confetti({
      particleCount: 150,
      spread: 90,
      gravity: 2,
    });
  }, []);

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full flex-col px-10 pb-12 pt-4 text-white">
        <Header title="Wallet Created" showPrevious={false} showClose={false} />
        <div className="mt-16 flex flex-grow flex-col justify-between">
          <div className="space-y-4">
            <img src={successImage} alt="Success" className="mx-auto" />
            <div className="items-center space-y-2">
              <h3 className="text-center text-xl font-semibold text-teal-500">
                Success
              </h3>
              <h5 className="text-center text-sm text-gray-400">
                Wallet created successfully
              </h5>
            </div>
          </div>
          <button
            className="rounded-full bg-icy-blue-400 py-5 text-base hover:bg-icy-blue-600"
            onClick={reopenPopup}
          >
            Open Wallet
          </button>
        </div>
      </div>
    </div>
  );
}
