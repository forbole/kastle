import ReceiveAddress from "@/components/screens/receive-addresses/ReceiveAddress.tsx";
import useWalletManager from "@/hooks/useWalletManager";
import kasIcon from "@/assets/images/kas-icon.svg";

export default function KaspaReceiveAddress() {
  const { account } = useWalletManager();
  const address = account?.address ?? "";

  return (
    <ReceiveAddress address={address} chainName="Kaspa" iconUrl={kasIcon} />
  );
}
