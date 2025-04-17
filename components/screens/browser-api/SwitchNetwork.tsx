import signImage from "@/assets/images/sign.png";
import Header from "@/components/GeneralHeader";
import { twMerge } from "tailwind-merge";

type SwitchNetworkProps = {
  selectedNetwork: {
    name: string;
    text: string;
    background: string;
    iconColor: string;
  };
  onConfirm: () => void;
};

export default function SwitchNetwork({
  selectedNetwork,
  onConfirm: onConfirm,
}: SwitchNetworkProps) {
  return (
    <div className="flex h-full flex-col">
      <div>
        <Header showPrevious={false} showClose={false} title="Confirm" />
        <div className="relative">
          <img src={signImage} alt="Sign" className="mx-auto" />
          <div
            className={twMerge(
              "absolute right-0 top-0 flex items-center gap-2 rounded-full px-2",
              selectedNetwork.text,
              selectedNetwork.background,
            )}
          >
            <i
              className={twMerge("rounded-full p-1", selectedNetwork.iconColor)}
            />
            {selectedNetwork.name}
          </div>
        </div>

        <div className="mt-12 space-y-16 text-center">
          <h3 className="text-xl font-semibold">
            {"You're on a different network than the one required."}
          </h3>
          <button
            onClick={onConfirm}
            className="rounded-full bg-icy-blue-400 p-5 text-base font-semibold hover:bg-icy-blue-600"
          >
            Switch to {selectedNetwork.name}
          </button>
        </div>
      </div>
    </div>
  );
}
