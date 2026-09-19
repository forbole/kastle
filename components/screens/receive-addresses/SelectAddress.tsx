import Header from "@/components/GeneralHeader";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import AddressItem from "@/components/screens/receive-addresses/AddressItem";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/hooks/useSettings";
import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { numberToHex } from "viem";
import { getChainImage } from "@/lib/layer2";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import { useEffect, useState } from "react";
import { getZKasPublicAccount } from "@/lib/zkas/popup-client";
import zkasIcon from "@/assets/images/network-logos/zkas.svg";

export default function SelectAddress() {
  const { account, walletSettings } = useWalletManager();
  const navigate = useNavigate();
  const [settings] = useSettings();

  const supportEvmL2s =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const kasAddress = account?.address ?? "";
  const evmAddress = useEvmAddress();
  const [zkasAccount, setZkasAccount] = useState<{ address: string; network: string; walletId: string; accountIndex: number }>();

  useEffect(() => {
    let active = true;
    setZkasAccount(undefined);
    void getZKasPublicAccount().then((value) => {
      if (active) setZkasAccount(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [walletSettings?.selectedWalletId, walletSettings?.selectedAccountIndex, settings?.networkId]);

  return (
    <div className="flex h-full flex-col p-4">
      <Header title="Select Address" showClose={false} />
      <div className="flex flex-col gap-2">
        <AddressItem
          address={kasAddress}
          chainName={
            settings?.networkId === "mainnet" ? "Kaspa" : "Kaspa Testnet"
          }
          imageUrl={kasIcon}
          redirect={() => navigate("/receive/kaspa")}
        />

        {zkasAccount && zkasAccount.walletId === walletSettings?.selectedWalletId &&
          zkasAccount.accountIndex === walletSettings?.selectedAccountIndex &&
          zkasAccount.network === (settings?.networkId === "mainnet" ? "mainnet" : "testnet") && <AddressItem
          address={zkasAccount.address}
          chainName={zkasAccount.network === "mainnet" ? "ZKas" : "ZKas Testnet"}
          imageUrl={zkasIcon}
          redirect={() => navigate("/receive/zkas")}
        />}

        {supportEvmL2s.map((chain) => {
          const chainName = chain.name;
          const chainIdHex = numberToHex(chain.id);
          const chainIcon = getChainImage(chainIdHex);
          return (
            <AddressItem
              key={chain.id}
              address={evmAddress ?? ""}
              chainName={chainName}
              imageUrl={chainIcon}
              redirect={() => navigate(`/receive/evm/${chainIdHex}`)}
            />
          );
        })}
      </div>
    </div>
  );
}
