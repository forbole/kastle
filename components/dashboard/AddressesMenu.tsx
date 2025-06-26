import kasIcon from "@/assets/images/kas-icon.svg";
import AddressItem from "./AddressItem";
import useWalletManager from "@/hooks/useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import kasplexIcon from "@/assets/images/kasplex-icon.png";

export default function AddressesMenu() {
  const { account } = useWalletManager();

  const kasAddress = account?.address ?? "";
  const evmAddress = toEvmAddress(account?.publicKeys?.[0] ?? "");

  return (
    <div className="absolute left-0 top-12 z-20 cursor-default rounded-2xl border border-daintree-700 bg-daintree-800">
      <AddressItem address={kasAddress} chainName="Kaspa" imageUrl={kasIcon} />
      <AddressItem
        address={evmAddress}
        chainName="Kasplex"
        imageUrl={kasplexIcon}
      />
    </div>
  );
}
