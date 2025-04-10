import { useSettings } from "@/hooks/useSettings";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import Header from "@/components/GeneralHeader";
import Link from "@/assets/images/link.svg";
import CheckCircle from "@/assets/images/check-circle.svg";
import { twMerge } from "tailwind-merge";

export default function RequestAccountUnlock() {
  const [settings] = useSettings();

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      iconColor: "bg-teal-500",
      background: "bg-teal-800",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet | T10",
      text: "text-yellow-500",
      iconColor: "bg-yellow-500",
      background: "bg-yellow-800",
    },
  ];
  const selectedNetwork = networks.find((n) => n.id === settings?.networkId);

  return (
    <div className="flex h-full w-full flex-col justify-between rounded-xl p-4">
      <div className="flex flex-col items-center">
        {/* Header */}
        <Header title={"Unlocked"} showPrevious={false} showClose={false} />
      </div>

      {/* Buttons */}
      <div className="flex gap-2 text-base font-semibold">
        <button
          className="flex-auto rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
          onClick={() => window.close()}
        >
          Close
        </button>
      </div>
    </div>
  );
}
