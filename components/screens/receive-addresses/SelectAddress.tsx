import Header from "@/components/GeneralHeader";
import useWalletManager from "@/hooks/useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import AddressItem from "@/components/screens/receive-addresses/AddressItem";
import kasIcon from "@/assets/images/kas-icon.svg";
import kasplexIcon from "@/assets/images/kasplex-icon.png";

export default function SelectAddress() {
  const { account } = useWalletManager();

  const kasAddress = account?.address ?? "";
  const evmAddress = toEvmAddress(account?.publicKeys?.[0] ?? "");

  return (
    <div className="flex h-full flex-col p-4">
      <Header title="Select Address" showClose={false} />
      <div className="flex flex-col gap-2">
        <AddressItem
          address={kasAddress}
          chainName="Kaspa"
          imageUrl={kasIcon}
        />
        <AddressItem
          address={evmAddress}
          chainName="Kasplex"
          imageUrl={kasplexIcon}
        />
      </div>
    </div>
  );
}
