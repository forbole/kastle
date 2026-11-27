import { useRef } from "react";
import { twMerge } from "tailwind-merge";
import braidLogo from "@/assets/images/providers/braid-logo.svg";
import kronLogo from "@/assets/images/providers/kron-logo.png";
import kassealLogo from "@/assets/images/providers/kasseal-logo.png";
import kaspaRocketLogo from "@/assets/images/providers/kasparocket-logo.png";
import type { Kcc20Family } from "@/lib/kcc20";

/** Providers with no lineage of their own: their tabs filter on what they route. */
export type SwapProviderTab = "kasseal" | "kasparocket";
export type SwapFamilyTab = "all" | Kcc20Family | SwapProviderTab;
/** Covenant ids each provider routes, the sets Swap.tsx already feeds L1Listings. */
export type ProviderCoverage = Partial<
  Record<SwapProviderTab, ReadonlySet<string> | undefined>
>;
type Row = { chain: string; family?: Kcc20Family; address?: string };

// Mobile's TokenSelectionSheet family filter, opening on All: a tap only filters, it never touches the pair.
// A family tab carries the mark of the provider that trades it: Braid lists Standard tokens, KRON its own.
export const FAMILY_TABS: {
  key: SwapFamilyTab;
  label: string;
  logo?: string;
}[] = [
  { key: "all", label: "All" },
  { key: "kcc20-standard", label: "Braid", logo: braidLogo },
  { key: "kron-legacy", label: "KRON", logo: kronLogo },
  { key: "kasseal", label: "Kasseal", logo: kassealLogo },
  { key: "kasparocket", label: "KaspaRocket", logo: kaspaRocketLogo },
];

const isProviderTab = (tab: SwapFamilyTab): tab is SwapProviderTab =>
  tab === "kasseal" || tab === "kasparocket";

/** The tabs to show: a provider that is off routes nothing, so it has no tab. */
export const visibleTabs = (on: Record<SwapProviderTab, boolean>) =>
  FAMILY_TABS.filter((t) => !isProviderTab(t.key) || on[t.key]);

/** A KCC-20 row of `tab`: its lineage, or for a provider tab, one it routes. */
const ofTab = (t: Row, tab: SwapFamilyTab, coverage?: ProviderCoverage) =>
  isProviderTab(tab)
    ? !!t.address && !!coverage?.[tab]?.has(t.address)
    : t.family === tab;

/** All keeps every row; off Kaspa L1 and for a row with no family (KAS, the counter leg) every tab does. */
export const inFamily = (
  t: Row,
  family: SwapFamilyTab,
  coverage?: ProviderCoverage,
) =>
  family === "all" ||
  t.chain !== "kaspa" ||
  !t.family ||
  ofTab(t, family, coverage);

/** Whether `rows` hold a KCC-20 row of `family`; without one the panel says so. All never empties. */
export const hasFamilyRow = (
  rows: Row[],
  family: SwapFamilyTab,
  coverage?: ProviderCoverage,
) =>
  family === "all" ||
  rows.some(
    (t) => t.chain === "kaspa" && !!t.family && ofTab(t, family, coverage),
  );

export default function SwapFamilyTabs({
  tabs,
  value,
  onChange,
  empty,
}: {
  /** visibleTabs(...): providers that are off contribute none. */
  tabs: typeof FAMILY_TABS;
  value: SwapFamilyTab;
  onChange: (family: SwapFamilyTab) => void;
  /** The active family has no rows: both tabs stay, so the way back is always there. */
  empty: boolean;
}) {
  const label = tabs.find((t) => t.key === value)?.label;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Same keys as AssetTabs: arrows wrap, Home / End jump; focus follows selection.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    // focus() alone leaves a tab past the edge hidden; scroll-px keeps its ring in.
    refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    onChange(tabs[next].key);
  };
  return (
    <div className="pb-2">
      {/* --prevent-on-load-init: Preline's HSTabs autoInit claims
          [role=tablist] and throws when no child carries its `active` class. */}
      {/* Five pills overflow 320 px: the row scrolls, never wraps. -m-1 p-1
          gives the focus ring room inside the scroll clip. */}
      <div
        role="tablist"
        className="--prevent-on-load-init no-scrollbar -m-1 flex scroll-px-1 gap-2 overflow-x-auto p-1"
      >
        {tabs.map((t, index) => (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={t.key === value}
            tabIndex={t.key === value ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={twMerge(
              "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium",
              t.key === value
                ? "border-icy-blue-400 bg-icy-blue-400 text-white"
                : "border-daintree-700 text-daintree-400",
            )}
          >
            {t.logo && (
              <img src={t.logo} alt="" className="size-5 rounded-full" />
            )}
            {t.label}
          </button>
        ))}
      </div>
      {empty && (
        <p className="py-4 text-center text-sm text-daintree-400">
          No {label} tokens to trade
        </p>
      )}
    </div>
  );
}
