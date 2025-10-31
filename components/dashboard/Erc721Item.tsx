import { convertIPFStoHTTP } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import NFTPlaceholderImage from "@/components/NFTPlaceholderImage.tsx";
import { NftAsset } from "@/hooks/evm/useErc721AssetsFromApi";

const NAME_LIMIT = 14;

export default function ERC721Item({
  chainId,
  asset,
}: {
  chainId: string;
  asset: NftAsset;
}) {
  const navigate = useNavigate();

  const onClick = () => {
    navigate(`/erc721/${chainId}/${asset.token.address_hash}/${asset.id}`);
  };

  const name = `${asset.metadata?.name} #${asset.id}`;

  return (
    <>
      <div
        className="relative cursor-pointer rounded-xl border border-[#203C49] bg-[#072735]"
        onClick={onClick}
      >
        <NFTPlaceholderImage
          src={asset.image_url}
          alt={asset.metadata?.name}
          className="m-auto max-h-28 rounded-xl"
        />
        <div className="absolute bottom-0 left-0 right-0 m-1 rounded-full border border-[#203C49] bg-[#102832] py-1.5 text-center text-[10px] leading-none text-white">
          {name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT)}...` : name}
        </div>
      </div>
    </>
  );
}
