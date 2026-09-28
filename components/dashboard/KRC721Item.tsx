import {
  requestCacheSlot,
  useKRC721CacheBase,
  useKRC721Metadata,
} from "@/hooks/krc721/useKRC721";
import { convertIPFStoHTTP } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import NFTPlaceholderImage from "@/components/NFTPlaceholderImage.tsx";

const NAME_LIMIT = 14;

// The cards take turns for kaspa.com's cache (see requestCacheSlot), in
// mount order, i.e. grid order.
function useCacheSlot() {
  const [granted, setGranted] = useState(false);
  const release = useRef(() => {});

  useEffect(() => {
    release.current = requestCacheSlot(() => setGranted(true));
    return () => release.current();
  }, []);

  return [granted, useCallback(() => release.current(), [])] as const;
}

export default function KRC721Item({
  tick,
  tokenId,
  buri,
}: {
  tick: string;
  tokenId: string;
  buri?: string;
}) {
  // Mobile's order: kaspa.com's cached thumbnail first, which needs no
  // metadata at all, and only if that image fails the IPFS metadata and the
  // artwork it names. The cache answers 400 for a token it does not know.
  // ponytail: mobile tries the cache's metadata before IPFS; skipped, the
  // artwork it names is on IPFS either way.
  const [cacheFailed, setCacheFailed] = useState(false);
  const [slot, releaseSlot] = useCacheSlot();
  const { data } = useKRC721Metadata(cacheFailed ? buri : undefined, tokenId);
  const navigate = useNavigate();
  const cacheBase = useKRC721CacheBase();
  const cacheSrc = `${cacheBase}/thumbnail/${tick}/${tokenId}`;

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
        src={
          cacheFailed
            ? data && convertIPFStoHTTP(data.image)
            : slot
              ? cacheSrc
              : undefined
        }
        onLoad={releaseSlot}
        onError={() => {
          releaseSlot();
          setCacheFailed(true);
        }}
        alt={data?.name ?? name}
        // Fills the tile and crops, as mobile's expo-image `cover` does.
        className="h-28 w-full rounded-xl object-cover"
        placeholder={{ className: "h-28 w-full rounded-xl object-cover" }}
      />
      <div className="absolute bottom-0 left-0 right-0 m-1 rounded-full border border-[#203C49] bg-[#102832] py-1.5 text-center text-[10px] leading-none text-white">
        {name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT)}...` : name}
      </div>
    </div>
  );
}
