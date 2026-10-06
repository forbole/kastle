import { Search } from "lucide-react";
import { twMerge } from "tailwind-merge";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import igraIcon from "@/assets/images/network-logos/igra.svg";
import PageHeader from "@/ui/general/PageHeader";
import TokenItem, { TokenItemProps } from "./TokenItem";
import {
  KCC20_LABELS,
  NETWORK_FILTER_LABELS,
  NetworkFilter,
  NetworkType,
} from "./labels";

const FILTERS: { key: NetworkFilter; logo: string }[] = [
  { key: "kaspa", logo: kasIcon },
  { key: "krc20", logo: kasIcon },
  { key: "kasplex", logo: kasplexIcon },
  { key: "igra", logo: igraIcon },
];

export const ALL_NETWORK_FILTERS = FILTERS.map((f) => f.key);

// "Kaspa (with KCC20)": the Kaspa chip covers native KAS and KCC-20.
const FILTER_OF: Record<NetworkType, NetworkFilter> = {
  kaspa: "kaspa",
  kcc20: "kaspa",
  krc20: "krc20",
  kasplexErc20: "kasplex",
  igraErc20: "igra",
};

export type SendSelectToken = Omit<
  TokenItemProps,
  "variant" | "onClick" | "network"
> & { id: string; network: NetworkType };

export interface SendSelectTokenPageProps {
  tokens: SendSelectToken[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** Multi-select; a token shows only if its network is selected. Figma defaults to all (ALL_NETWORK_FILTERS). */
  selectedFilters: NetworkFilter[];
  onFiltersChange: (filters: NetworkFilter[]) => void;
  onTokenSelect: (id: string) => void;
  isLoading?: boolean;
  onBack?: () => void;
  onClose?: () => void;
}

export default function SendSelectTokenPage({
  tokens,
  searchQuery,
  onSearchChange,
  selectedFilters,
  onFiltersChange,
  onTokenSelect,
  isLoading = false,
  onBack,
  onClose,
}: SendSelectTokenPageProps) {
  const query = searchQuery.trim().toLowerCase();
  const visible = tokens.filter(
    (t) =>
      (!query ||
        t.name.toLowerCase().includes(query) ||
        !!t.subtitle?.toLowerCase().includes(query)) &&
      selectedFilters.includes(FILTER_OF[t.network]),
  );

  const toggle = (key: NetworkFilter) =>
    onFiltersChange(
      selectedFilters.includes(key)
        ? selectedFilters.filter((k) => k !== key)
        : [...selectedFilters, key],
    );

  return (
    <div className="flex h-full flex-col bg-icy-blue-950 font-sans text-white">
      <PageHeader
        title={KCC20_LABELS.selectToken}
        onBack={onBack}
        showClose={!!onClose}
        onClose={onClose}
      />

      <div className="px-4">
        <label className="flex h-10 items-center gap-2 rounded-xl border border-search-border bg-daintree-800 px-3">
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-daintree-300"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={KCC20_LABELS.searchPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full border-0 bg-transparent p-0 text-base text-white placeholder-daintree-300 focus:ring-0"
          />
        </label>

        <div className="no-scrollbar flex gap-2 overflow-x-auto py-3">
          {FILTERS.map(({ key, logo }) => {
            const active = selectedFilters.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(key)}
                className={twMerge(
                  "flex h-9 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium text-white",
                  active
                    ? "border-filter-active bg-white/10"
                    : "border-card-border bg-white/5",
                )}
              >
                <img
                  alt=""
                  src={logo}
                  className="size-5 rounded-full bg-black object-cover"
                />
                {NETWORK_FILTER_LABELS[key]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-daintree-400">
            {isLoading ? KCC20_LABELS.loadingTokens : KCC20_LABELS.noTokens}
          </p>
        ) : (
          visible.map(({ id, ...token }) => (
            <TokenItem key={id} {...token} onClick={() => onTokenSelect(id)} />
          ))
        )}
      </div>
    </div>
  );
}
