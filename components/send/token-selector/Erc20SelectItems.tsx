import { useSettings } from "@/hooks/useSettings";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import Erc20SelectItem from "./Erc20SelectItem";

export default function Erc20SelectItems({
  searchQuery,
  toggleShow,
}: {
  searchQuery?: string;
  toggleShow: () => void;
}) {
  const { assets } = useErc20Assets();

  return (
    <>
      {assets
        .filter((asset) => asset.symbol.startsWith(searchQuery ?? ""))
        .map((asset) => (
          <Erc20SelectItem
            key={`${asset.chainId}-${asset.address}`}
            asset={asset}
            toggleShow={toggleShow}
          />
        ))}
    </>
  );
}
