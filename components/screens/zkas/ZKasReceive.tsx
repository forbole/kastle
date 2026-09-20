import ReceiveAddress from "@/components/screens/receive-addresses/ReceiveAddress";
import Header from "@/components/GeneralHeader";
import zkasIcon from "@/assets/images/network-logos/zkas.svg";
import useSelectedZKasAddress from "@/hooks/useSelectedZKasAddress";

export default function ZKasReceive() {
  const { account, loading, error } = useSelectedZKasAddress();
  if (!account) {
    return (
      <div className="p-4">
        <Header title="Receive ZKAS" />
        <p role="status">
          {error ||
            (loading
              ? "Loading address…"
              : "Enable Experimental features and select a supported wallet account.")}
        </p>
      </div>
    );
  }
  return (
    <ReceiveAddress
      address={account.address}
      chainName="ZKas Mainnet"
      iconUrl={zkasIcon}
    />
  );
}
