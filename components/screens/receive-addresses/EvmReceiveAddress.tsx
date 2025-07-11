import ReceiveAddress from "@/components/screens/receive-addresses/ReceiveAddress.tsx";
import { useParams } from "react-router-dom";
import { getChainImage, getChainName } from "@/lib/layer2";
import useEvmAddress from "@/hooks/evm/useEvmAddress";

export default function EvmReceiveAddress() {
  const { chainId } = useParams<{ chainId: `0x${string}` }>();
  const evmAddress = useEvmAddress();
  const chainName = getChainName(chainId ?? "0x0");
  const chainImage = getChainImage(chainId ?? "0x0");

  return (
    <ReceiveAddress
      address={evmAddress ?? ""}
      chainName={chainName}
      iconUrl={chainImage}
    />
  );
}
