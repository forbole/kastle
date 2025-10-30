import { AssetData } from "@/hooks/kns/useKns";
import { useNavigate } from "react-router-dom";
import { textEllipsis } from "@/lib/utils.ts";
import avatarIcon from "@/assets/images/avatar.png";

type KNSTextItemProps = {
  asset: AssetData;
};

export default function KNSTextItem({ asset }: KNSTextItemProps) {
  const navigate = useNavigate();

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/kns-text/${asset.assetId}`)}
    >
      <img alt="castle" className="h-[40px] w-[40px]" src={avatarIcon}></img>
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-center justify-between text-base text-white">
          <span>{asset.asset}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>{textEllipsis(asset.owner)}</span>
        </div>
      </div>
    </div>
  );
}
