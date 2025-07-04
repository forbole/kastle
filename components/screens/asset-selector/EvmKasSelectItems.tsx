import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { useSettings } from "@/hooks/useSettings";
import { NetworkType } from "@/contexts/SettingsContext";
import EvmKasSelectItem from "./EvmKasSelectItem";
import { numberToHex } from "viem";

export default function EvmKasSelectItems() {
  const [settings] = useSettings();
  const network = settings?.networkId ?? NetworkType.Mainnet;
  const supportedChains =
    network === NetworkType.Mainnet ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  return (
    <>
      {supportedChains.map((chain) => (
        <EvmKasSelectItem
          key={numberToHex(chain.id)}
          chainId={numberToHex(chain.id)}
        />
      ))}
    </>
  );
}
