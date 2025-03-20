import { useKRC721Details } from "@/hooks/useKRC721";
import { convertIPFStoHTTP } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

export default function KRC721Item({
  tick,
  tokenId,
}: {
  tick: string;
  tokenId: string;
}) {
  const { data } = useKRC721Details(tick, tokenId);
  const navigate = useNavigate();

  const onClick = () => {
    navigate(`/krc721/${tick}/${tokenId}`);
  };

  const name = `${tick} #${tokenId}`;

  return (
    <>
      {data && (
        <div className="relative cursor-pointer" onClick={onClick}>
          <img
            src={convertIPFStoHTTP(data.image)}
            alt={data.name}
            className="rounded-xl"
          />
          <div className="absolute bottom-0 left-0 right-0 m-1 rounded-full border-[#203C49] bg-[#102832] py-1.5 text-center text-[10px] leading-none text-white">
            {name.length >= 14 ? `${name.slice(0, 14)}...` : name}
          </div>
        </div>
      )}
    </>
  );
}
