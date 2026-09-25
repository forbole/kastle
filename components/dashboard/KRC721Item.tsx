import { useKRC721Metadata } from "@/hooks/krc721/useKRC721";
import { convertIPFStoHTTP } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import NFTPlaceholderImage from "@/components/NFTPlaceholderImage.tsx";
import { KRC721_CACHE_URLS, NetworkType } from "@/contexts/SettingsContext";

const NAME_LIMIT = 14;

// kaspa.com's cache answers a burst from one client with 429s (measured: 16
// of 50 at once, then 49 of the next 50; 0 of 50 at five in flight), so the
// cards take turns. Slots are granted in mount order, i.e. grid order.
// ponytail: same shape as mobile's KRC721_CACHE_MAX_IN_FLIGHT limiter.
const CACHE_MAX_IN_FLIGHT = 5;
let inFlight = 0;
const waiters: (() => void)[] = [];

function useCacheSlot() {
  const [granted, setGranted] = useState(false);
  const held = useRef(false);

  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    const next = waiters.shift();
    if (next) next();
    else inFlight -= 1;
  }, []);

  useEffect(() => {
    const grant = () => {
      held.current = true;
      setGranted(true);
    };
    if (inFlight < CACHE_MAX_IN_FLIGHT) {
      inFlight += 1;
      grant();
    } else waiters.push(grant);
    return () => {
      const i = waiters.indexOf(grant);
      if (i >= 0) waiters.splice(i, 1);
      release();
    };
  }, [release]);

  return [granted, release] as const;
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
  const { networkId } = useRpcClientStateful();
  // Mobile's order: kaspa.com's cached thumbnail first, which needs no
  // metadata at all, and only if that image fails the IPFS metadata and the
  // artwork it names. The cache answers 400 for a token it does not know.
  // ponytail: mobile tries the cache's metadata before IPFS; skipped, the
  // artwork it names is on IPFS either way.
  const [cacheFailed, setCacheFailed] = useState(false);
  const [slot, releaseSlot] = useCacheSlot();
  const { data } = useKRC721Metadata(cacheFailed ? buri : undefined, tokenId);
  const navigate = useNavigate();
  const cacheSrc = `${KRC721_CACHE_URLS[networkId ?? NetworkType.Mainnet]}/thumbnail/${tick}/${tokenId}`;

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
        className="m-auto max-h-28 rounded-xl"
        placeholder={{ className: "m-auto max-h-28 rounded-xl" }}
      />
      <div className="absolute bottom-0 left-0 right-0 m-1 rounded-full border border-[#203C49] bg-[#102832] py-1.5 text-center text-[10px] leading-none text-white">
        {name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT)}...` : name}
      </div>
    </div>
  );
}
