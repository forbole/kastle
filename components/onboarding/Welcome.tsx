import castleImage from "@/assets/images/castle.png";
import { useFormContext } from "react-hook-form";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";

export default function Welcome() {
  const form = useFormContext<OnboardingData>();

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div
        id="onboarding"
        className="flex h-full flex-col justify-between px-10"
      >
        <div className="flex flex-col items-center gap-10 pt-12">
          <img alt="castle" className="h-[229px] w-[229px]" src={castleImage} />
          <div className="flex flex-col items-center gap-3">
            <div className="text-center text-lg font-semibold text-daintree-400">
              Welcome to Kastle
            </div>
            <div className="text-3xl font-semibold text-gray-200">
              Your Gateway to Kaspa
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 py-6">
          <button
            className="flex justify-center gap-2 rounded-full bg-icy-blue-400 px-6 py-3.5 text-center text-base font-semibold text-white"
            onClick={() => {
              form.setValue("method", "create");
              form.setValue("step", "password");
            }}
          >
            Create new wallet
          </button>
          <button
            className="flex justify-center gap-2 rounded-full border border-daintree-400 bg-transparent px-6 py-3.5 text-center text-base font-semibold text-daintree-200"
            onClick={() => {
              form.setValue("method", "import");
              form.setValue("step", "password");
            }}
          >
            Import existing wallet
          </button>
        </div>
      </div>
    </div>
  );
}
