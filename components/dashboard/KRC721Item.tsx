import { useKRC721Metadata } from "@/hooks/krc721/useKRC721";
import { convertIPFStoHTTP } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import NFTPlaceholderImage from "@/components/NFTPlaceholderImage.tsx";

const NAME_LIMIT = 14;

export default function KRC721Item({
  tick,
  tokenId,
  buri,
}: {
  tick: string;
  tokenId: string;
  buri?: string;
}) {
  const { data } = useKRC721Metadata(buri, tokenId);
  const navigate = useNavigate();

  const onClick = () => {
    navigate(`/krc721/${tick}/${tokenId}`);
  };

  const name = `${tick} #${tokenId}`;

  // The card is drawn from the indexer row alone; metadata only upgrades the
  // placeholder to the artwork. A metadata failure (or a row with no buri)
  // therefore keeps its slot instead of silently shrinking the grid.
  return (
    <div
      className="relative cursor-pointer rounded-xl border border-[#203C49] bg-[#072735]"
      onClick={onClick}
    >
      <NFTPlaceholderImage
        src={data ? convertIPFStoHTTP(data.image) : undefined}
        alt={data?.name ?? name}
        className="m-auto max-h-28 rounded-xl"
        placeholder={{ className: "m-auto max-h-28 rounded-xl" }}
      />
      <div className="absolute bottom-0 left-0 right-0 m-1 rounded-full border border-[#203C49] bg-[#102832] py-1.5 text-center text-[10px] leading-none text-white">
        {name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT)}...` : name}
      </div>
    </div>
  );
}
