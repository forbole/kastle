import ReceiveAddress from "@/components/screens/receive-addresses/ReceiveAddress.tsx";
import useWalletManager from "@/hooks/useWalletManager";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { useSettings } from "@/hooks/useSettings";

export default function KaspaReceiveAddress() {
  const { account } = useWalletManager();
  const address = account?.address ?? "";
  const [settings] = useSettings();

  const chainName =
    settings?.networkId === "mainnet" ? "Kaspa" : "Kaspa Testnet";

  return (
    <ReceiveAddress address={address} chainName={chainName} iconUrl={kasIcon} />
  );
}
