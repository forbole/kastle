import React from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useAssetsByAddress } from "@/hooks/useKns.ts";
import KNSTextItem from "@/components/dashboard/KNSTextItem.tsx";

export default function KNSText() {
  const { account } = useWalletManager();
  const { data: response, isLoading } = useAssetsByAddress(
    "text",
    account?.address ?? "",
  );

  return (
    <div className="space-y-2 pb-4">
      {isLoading &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[72px] animate-pulse cursor-pointer rounded-xl border border-daintree-700 bg-daintree-800 p-3"
          />
        ))}
      {!isLoading &&
        response?.data.assets.map((asset) => (
          <KNSTextItem key={asset.assetId} asset={asset} />
        ))}
    </div>
  );
}
