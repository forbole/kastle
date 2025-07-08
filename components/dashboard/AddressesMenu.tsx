import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import AddressItem from "./AddressItem";
import useWalletManager from "@/hooks/useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { useSettings } from "@/hooks/useSettings";
import { numberToHex } from "viem";
import { getChainImage } from "@/lib/layer2";
import { useRef, useEffect } from "react";

export default function AddressesMenu({ onClose }: { onClose: () => void }) {
  const { account } = useWalletManager();
  const navigate = useNavigate();
  const [settings] = useSettings();
  const menuRef = useRef<HTMLDivElement>(null);

  const kasAddress = account?.address ?? "";
  const evmAddress = toEvmAddress(account?.publicKeys?.[0] ?? "");

  const supportEvmL2s =
    settings?.networkId === "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div ref={menuRef}>
      <div className="absolute left-0 top-12 z-20 cursor-default rounded-2xl border border-daintree-700 bg-daintree-800">
        <AddressItem
          address={kasAddress}
          chainName={
            settings?.networkId === "mainnet" ? "Kaspa" : "Kaspa Testnet"
          }
          imageUrl={kasIcon}
          redirect={() => navigate("/receive/kaspa")}
        />

        {supportEvmL2s.map((chain) => {
          const chainName = chain.name;
          const chainIdHex = numberToHex(chain.id);
          const chainIcon = getChainImage(chainIdHex);

          return (
            <AddressItem
              key={chain.id}
              address={evmAddress}
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
