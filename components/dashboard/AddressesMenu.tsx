import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import zkasIcon from "@/assets/images/network-logos/zkas.svg";
import AddressItem from "./AddressItem";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useNavigate } from "react-router-dom";
import {
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { useSettings } from "@/hooks/useSettings";
import { numberToHex } from "viem";
import { getChainImage } from "@/lib/layer2";
import { useRef, useEffect } from "react";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useSelectedZKasAddress from "@/hooks/useSelectedZKasAddress";

export default function AddressesMenu({ onClose }: { onClose: () => void }) {
  const { wallet, account } = useWalletManager();
  const navigate = useNavigate();
  const [settings] = useSettings();
  const menuRef = useRef<HTMLDivElement>(null);

  const kasAddress = account?.address ?? "";
  const evmAddress = useEvmAddress();
  const { account: zkasAccount, loading: zkasLoading, error: zkasError } =
    useSelectedZKasAddress();

  const supportEvmL2s =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

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

        {zkasLoading && (
          <p role="status" className="px-3 py-2 text-xs text-daintree-400">
            Loading ZKas address…
          </p>
        )}
        {zkasError && (
          <p role="alert" className="px-3 py-2 text-xs text-red-400">
            {zkasError}
          </p>
        )}
        {zkasAccount && (
          <AddressItem
            address={zkasAccount.address}
            chainName="ZKas Mainnet"
            imageUrl={zkasIcon}
            redirect={() => navigate("/receive/zkas")}
          />
        )}

        {wallet?.type !== "ledger" &&
          supportEvmL2s.map((chain) => {
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
