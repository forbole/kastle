import { AssetData } from "@/hooks/useDomainsByAddress.ts";
import avatarIcon from "@/assets/images/avatar.png";
import { useNavigate } from "react-router-dom";
import { walletAddressEllipsis } from "@/lib/utils.ts";

type KNSItemProps = {
  asset: AssetData;
};

export default function KNSItem({ asset }: KNSItemProps) {
  const navigate = useNavigate();

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/kns/${asset.assetId}`)}
    >
      <img alt="castle" className="h-[40px] w-[40px]" src={avatarIcon} />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-center justify-between text-base text-white">
          <span>{asset.asset}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>{walletAddressEllipsis(asset.owner)}</span>
        </div>
      </div>
    </div>
  );
}
