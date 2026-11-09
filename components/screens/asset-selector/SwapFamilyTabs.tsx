import { useRef } from "react";
import { twMerge } from "tailwind-merge";
import braidLogo from "@/assets/images/providers/braid-logo.svg";
import kronLogo from "@/assets/images/providers/kron-logo.png";
import type { Kcc20Family } from "@/lib/kcc20";

export type SwapFamilyTab = "all" | Kcc20Family;

// Mobile's TokenSelectionSheet family filter, opening on All: a tap only filters, it never touches the pair.
// A family tab carries the mark of the provider that trades it: Braid lists Standard tokens, KRON its own.
export const FAMILY_TABS: {
  key: SwapFamilyTab;
  label: string;
  logo?: string;
}[] = [
  { key: "all", label: "All" },
  { key: "kcc20-standard", label: "Standard", logo: braidLogo },
  { key: "kron-legacy", label: "KRON", logo: kronLogo },
];

/** All keeps every row; off Kaspa L1 and for a row with no family (KAS, the counter leg) every tab does. */
export const inFamily = (
  t: { chain: string; family?: Kcc20Family },
  family: SwapFamilyTab,
) =>
  family === "all" || t.chain !== "kaspa" || !t.family || t.family === family;

/** Whether `rows` hold a KCC-20 row of `family`; without one the panel says so. All never empties. */
export const hasFamilyRow = (
  rows: { chain: string; family?: Kcc20Family }[],
  family: SwapFamilyTab,
) =>
  family === "all" ||
  rows.some((t) => t.chain === "kaspa" && t.family === family);

export default function SwapFamilyTabs({
  value,
  onChange,
  empty,
}: {
  value: SwapFamilyTab;
  onChange: (family: SwapFamilyTab) => void;
  /** The active family has no rows: both tabs stay, so the way back is always there. */
  empty: boolean;
}) {
  const label = FAMILY_TABS.find((t) => t.key === value)?.label;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Same keys as AssetTabs: arrows wrap, Home / End jump; focus follows selection.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = FAMILY_TABS.length - 1;
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
    refs.current[next]?.focus();
    onChange(FAMILY_TABS[next].key);
  };
  return (
    <div className="pb-2">
      {/* --prevent-on-load-init: Preline's HSTabs autoInit claims
          [role=tablist] and throws when no child carries its `active` class. */}
      <div role="tablist" className="--prevent-on-load-init flex gap-2">
        {FAMILY_TABS.map((t, index) => (
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
              "flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium",
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
