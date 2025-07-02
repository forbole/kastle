import ReceiveAddress from "@/components/screens/receive-addresses/ReceiveAddress.tsx";
import useWalletManager from "@/hooks/useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import { useParams } from "react-router-dom";
import { getChainImage, getChainName } from "@/lib/layer2";

export default function EvmReceiveAddress() {
  const { chainId } = useParams<{ chainId: `0x${string}` }>();
  const { account } = useWalletManager();
  const evmAddress = toEvmAddress(account?.publicKeys?.[0] ?? "");
  const chainName = getChainName(chainId ?? "0x0");
  const chainImage = getChainImage(chainId ?? "0x0");

  return (
    <ReceiveAddress
      address={evmAddress}
      chainName={chainName}
      iconUrl={chainImage}
    />
  );
}
