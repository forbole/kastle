import { useEffect, useRef } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import AssetImage from "@/ui/popup/kcc20/AssetImage";
import { NETWORK_TYPE_LABELS, type NetworkType } from "@/ui/popup/kcc20/labels";

export interface AssetSearchItem {
  id: string;
  name: string;
  /** Drives the secondary line and the logo shape: a round token or a square NFT. */
  kind: "asset" | "nft";
  logo?: string;
  /** Picks the corner badge on an asset logo. */
  network?: NetworkType;
}

export interface AssetSearchPageProps {
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  /** Shown under "Recent" while the query is empty. */
  recent: AssetSearchItem[];
  /** Shown once the query is filled. */
  results: AssetSearchItem[];
  /** Skeleton rows follow any results already loaded. */
  isLoading?: boolean;
  onSelect: (item: AssetSearchItem) => void;
  onRemoveRecent: (item: AssetSearchItem) => void;
}

const ASSET_SEARCH_LABELS = {
  placeholder: "Search assets",
  clear: "Clear search",
  back: "Back",
  recent: "Recent",
  noResult: "No result found",
  asset: "Asset",
  nft: "NFT",
  remove: "Remove from recent",
  searching: "Searching",
  found: (count: number) =>
    `${count} ${count === 1 ? "result" : "results"} found`,
};

/** Name plus network, so same-named assets on different networks stay distinct to assistive tech. */
function accessibleName(item: AssetSearchItem) {
  return item.network
    ? `${item.name}, ${NETWORK_TYPE_LABELS[item.network]}`
    : item.name;
}

const SKELETON_ROWS = 6;

function ItemLogo({ item }: { item: AssetSearchItem }) {
  // Fixed 40px box: the asset's corner badge overhangs it, so names align.
  return (
    <div className="flex w-10 shrink-0">
      {item.kind === "nft" ? (
        <img
          alt=""
          src={item.logo}
          className="h-[46px] w-10 shrink-0 rounded-[10px] bg-daintree-750 object-cover"
        />
      ) : (
        <AssetImage
          variant="chain"
          tokenImage={item.logo}
          network={item.network}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  onSelect,
  onRemove,
}: {
  item: AssetSearchItem;
  onSelect: (item: AssetSearchItem) => void;
  onRemove?: (item: AssetSearchItem) => void;
}) {
  return (
    <div className="flex items-center rounded-lg focus-within:bg-daintree-800 hover:bg-daintree-800">
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
      >
        <ItemLogo item={item} />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-semibold leading-5 text-white">
            {item.name}
            {item.network && (
              <span className="sr-only">
                , {NETWORK_TYPE_LABELS[item.network]}
              </span>
            )}
          </span>
          <span className="text-xs leading-4 text-daintree-400">
            {item.kind === "nft"
              ? ASSET_SEARCH_LABELS.nft
              : ASSET_SEARCH_LABELS.asset}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`${ASSET_SEARCH_LABELS.remove}: ${accessibleName(item)}`}
          data-recent-remove={item.id}
          onClick={() => onRemove(item)}
          className="mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-daintree-300 hover:bg-daintree-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      className="flex animate-pulse items-center gap-3 rounded-lg px-3 py-2 motion-reduce:animate-none"
    >
      <div className="size-10 shrink-0 rounded-full bg-daintree-750" />
      <div className="flex h-10 w-[114px] flex-col justify-between">
        <div className="h-5 w-full rounded-xl bg-daintree-750" />
        <div className="h-3 w-[74px] rounded-xl bg-daintree-750" />
      </div>
    </div>
  );
}

export default function AssetSearchPage({
  query,
  onQueryChange,
  onBack,
  recent,
  results,
  isLoading = false,
  onSelect,
  onRemoveRecent,
}: AssetSearchPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const recentListRef = useRef<HTMLDivElement>(null);
  // Where focus goes once a removed recent row unmounts: a surviving row's id, or "" for the input.
  const pendingFocusRef = useRef<string | null>(null);
  const hasQuery = query.length > 0;

  // Focused on open, so typing starts straight away.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The removed row took the focused button with it; keep focus inside the search controls.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const next = target
      ? recentListRef.current?.querySelector<HTMLButtonElement>(
          `[data-recent-remove="${CSS.escape(target)}"]`,
        )
      : null;
    (next ?? inputRef.current)?.focus();
  }, [recent]);

  const removeRecent = (item: AssetSearchItem) => {
    const index = recent.findIndex((r) => r.id === item.id);
    const next = recent[index + 1] ?? recent[index - 1];
    pendingFocusRef.current = next ? next.id : "";
    onRemoveRecent(item);
  };

  const showRecent = !hasQuery && recent.length > 0;
  const showEmpty = hasQuery && !isLoading && results.length === 0;
  const status = !hasQuery
    ? ""
    : isLoading
      ? ASSET_SEARCH_LABELS.searching
      : results.length === 0
        ? ASSET_SEARCH_LABELS.noResult
        : ASSET_SEARCH_LABELS.found(results.length);

  return (
    <div
      className="flex h-full flex-col bg-icy-blue-950 font-sans text-white"
      onKeyDown={(e) => {
        // keyCode 229: IME composition on browsers that don't set isComposing.
        if (
          e.key === "Escape" &&
          !e.nativeEvent.isComposing &&
          e.keyCode !== 229
        )
          onBack();
      }}
    >
      <div className="flex items-start gap-2 px-4 pb-4 pt-5">
        <button
          type="button"
          aria-label={ASSET_SEARCH_LABELS.back}
          onClick={onBack}
          className="flex size-[46px] shrink-0 items-center justify-center rounded-lg text-white hover:bg-daintree-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <div className="relative mr-2 flex min-w-0 flex-1">
          <label className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-search-border bg-daintree-800 px-4 focus-within:border-icy-blue-400 focus-within:ring-4 focus-within:ring-blue-500/25">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-daintree-400"
            />
            <input
              ref={inputRef}
              aria-label={ASSET_SEARCH_LABELS.placeholder}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={ASSET_SEARCH_LABELS.placeholder}
              autoComplete="off"
              spellCheck={false}
              className={twMerge(
                "w-full min-w-0 border-0 bg-transparent px-0 py-3.5 text-[15px] font-medium text-white placeholder-daintree-400 focus:ring-0",
                hasQuery && "pr-8",
              )}
            />
          </label>
          {hasQuery && (
            <button
              type="button"
              aria-label={ASSET_SEARCH_LABELS.clear}
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-daintree-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        {/* Figma: the divider sits with the Recent header (and the first-visit page), not over results. */}
        {showRecent && (
          <>
            {/* Token gap: Figma hardShadow/4 has no Tailwind token, so arbitrary value. */}
            <h2 className="border-t border-card-border px-3 pt-3 text-base font-semibold leading-6 tracking-[0.08px] text-white drop-shadow-[0_-3px_5px_rgba(38,38,38,0.2)]">
              {ASSET_SEARCH_LABELS.recent}
            </h2>
            <div ref={recentListRef} className="flex flex-col gap-2 pb-4">
              {recent.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onSelect={onSelect}
                  onRemove={removeRecent}
                />
              ))}
            </div>
          </>
        )}

        {!hasQuery && !showRecent && (
          <div className="border-t border-card-border" />
        )}

        {hasQuery && results.length + (isLoading ? 1 : 0) > 0 && (
          <div className="flex flex-col gap-2 pb-4" aria-busy={isLoading}>
            {results.map((item) => (
              <ItemRow key={item.id} item={item} onSelect={onSelect} />
            ))}
            {isLoading &&
              Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <SkeletonRow key={i} />
              ))}
          </div>
        )}

        {showEmpty && (
          <p
            aria-hidden="true"
            className="pt-8 text-center text-base font-medium leading-6 text-daintree-400"
          >
            {ASSET_SEARCH_LABELS.noResult}
          </p>
        )}
      </div>

      {/* Mounted for the screen's lifetime so a text change is announced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}
