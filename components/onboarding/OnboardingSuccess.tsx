import React, { useEffect } from "react";
import castleImage from "@/assets/images/castle.png";
import confetti from "canvas-confetti";

export default function OnboardingSuccess() {
  const calledOnce = useRef(false);
  const { emitOnboardingComplete } = useAnalytics();

  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    emitOnboardingComplete();
  }, []);

  useEffect(() => {
    confetti({
      particleCount: 50,
      spread: 70,
      gravity: 2,
      origin: { y: 0.7 },
    });
  }, []);

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full w-full flex-col items-center justify-between px-4 py-6">
        <div className="flex flex-col items-center pt-9">
          <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
          <div className="flex flex-col items-center pt-10">
            <div className="text-center text-lg text-daintree-400">
              Success!
            </div>
            <div className="text-3xl font-semibold text-gray-200">
              Welcome your Majesty
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            browser.action.openPopup();
          }}
          className="w-full rounded-full bg-icy-blue-400 py-4 text-center text-base font-semibold text-white"
        >
          Explore Kastle
        </button>
      </div>
    </div>
  );
}
