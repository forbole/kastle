import { useEffect, useState } from "react";
import ReceiveAddress from "@/components/screens/receive-addresses/ReceiveAddress";
import Header from "@/components/GeneralHeader";
import { getZKasPublicAccount } from "@/lib/zkas/popup-client";
import zkasIcon from "@/assets/images/network-logos/zkas.svg";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useSettings } from "@/hooks/useSettings";

export default function ZKasReceive() {
  const { walletSettings } = useWalletManager();
  const [settings] = useSettings();
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setAddress("");
    setNetwork("");
    setError("");
    void getZKasPublicAccount().then((account) => {
      if (active) { setAddress(account.address); setNetwork(account.network); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load ZKas address");
    });
    return () => { active = false; };
  }, [walletSettings?.selectedWalletId, walletSettings?.selectedAccountIndex, settings?.networkId]);
  if (!address) {
    return <div className="p-4"><Header title="Receive ZKAS" /><p role="status">{error || "Loading address…"}</p></div>;
  }
  return <ReceiveAddress address={address} chainName={network === "mainnet" ? "ZKas" : "ZKas Testnet"} iconUrl={zkasIcon} />;
}
