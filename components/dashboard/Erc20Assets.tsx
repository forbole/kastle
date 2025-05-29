import useErc20Assets from "@/hooks/evm/useErc20Assets";
import Erc20Asset from "./Erc20Asset";

export default function Erc20Assets() {
  const { assets } = useErc20Assets();
  
  return (
    <div className="flex flex-col gap-2">
      {assets.map((asset, index) => (
        <Erc20Asset key={index} asset={asset} />
      ))}
    </div>
  );
}
