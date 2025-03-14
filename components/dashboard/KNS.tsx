import React, { useState } from "react";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useDomainsByAddress from "@/hooks/useDomainsByAddress.ts";
import KNSItem from "@/components/dashboard/KNSItem.tsx";

export default function KNS() {
  const { account } = useWalletManager();
  const { data: response, isLoading } = useDomainsByAddress(
    account?.address ?? "",
  );

  return (
    <>
      {isLoading &&
        Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="min-h-[72px] animate-pulse cursor-pointer rounded-xl border border-daintree-700 bg-daintree-800 p-3"
          />
        ))}
      {!isLoading &&
        response?.data.assets.map((asset) => (
          <KNSItem key={asset.assetId} asset={asset} />
        ))}
    </>
  );
}
