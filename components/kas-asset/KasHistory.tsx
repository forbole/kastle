import React from "react";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { explorerAddressLinks } from "@/components/screens/Settings.tsx";

export default function KasHistory() {
  const { addresses } = useWalletManager();
  const [settings] = useSettings();

  const network = settings?.networkId ?? NetworkType.Mainnet;
  const explorerAddressLink = explorerAddressLinks[network];
  const firstAddress = addresses[0];

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      <div className="flex flex-col items-stretch gap-2">
        <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
          <a
            className="flex cursor-pointer items-center gap-2"
            href={`${explorerAddressLink}${firstAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
              <i className="hn hn-external-link text-[20px] text-white"></i>
            </div>
            <span className="text-lg text-white">Explorer</span>
          </a>
        </div>
      </div>
    </div>
  );
}
