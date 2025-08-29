import React from "react";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { explorerAddressLinks } from "@/components/screens/Settings.tsx";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function KasHistory() {
  const { account } = useWalletManager();
  const { networkId } = useRpcClientStateful();

  const network = networkId ?? NetworkType.Mainnet;
  const explorerAddressLink = explorerAddressLinks[network];
  const firstAddress = account?.address;

  const openTransaction = () => {
    browser.tabs.create({
      url: `${explorerAddressLink}${firstAddress}`,
    });
  };

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
        onClick={() => openTransaction()}
      >
        <img
          alt="castle"
          className="h-[40px] w-[40px] rounded-full"
          src={kasIcon}
        />
        <span className="text-base font-medium">
          See activity history in explorer
        </span>
        <i className="hn hn-external-link text-[20px] text-daintree-400"></i>
      </button>
    </div>
  );
}
