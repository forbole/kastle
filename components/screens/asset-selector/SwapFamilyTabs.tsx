import { twMerge } from "tailwind-merge";
import type { Kcc20Family } from "@/lib/kcc20";

// Mobile's TokenSelectionSheet family filter, without "All": a tap only filters, it never touches the pair.
export const FAMILY_TABS: { key: Kcc20Family; label: string }[] = [
  { key: "kcc20-standard", label: "Standard" },
  { key: "kron-legacy", label: "KRON" },
];

/** Off Kaspa L1 and for a row with no family (KAS, the counter leg) every tab keeps the row. */
export const inFamily = (
  t: { chain: string; family?: Kcc20Family },
  family: Kcc20Family,
) => t.chain !== "kaspa" || !t.family || t.family === family;

/** Whether `rows` hold a KCC-20 row of `family`; without one the panel says so. */
export const hasFamilyRow = (
  rows: { chain: string; family?: Kcc20Family }[],
  family: Kcc20Family,
) => rows.some((t) => t.chain === "kaspa" && t.family === family);

export default function SwapFamilyTabs({
  value,
  onChange,
  empty,
}: {
  value: Kcc20Family;
  onChange: (family: Kcc20Family) => void;
  /** The active family has no rows: both tabs stay, so the way back is always there. */
  empty: boolean;
}) {
  const label = FAMILY_TABS.find((t) => t.key === value)?.label;
  return (
    <div className="pb-2">
      <div role="tablist" className="flex gap-2">
        {FAMILY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === value}
            onClick={() => onChange(t.key)}
            className={twMerge(
              "h-9 rounded-full border px-4 text-sm font-medium",
              t.key === value
                ? "border-icy-blue-400 bg-icy-blue-400 text-white"
                : "border-daintree-700 text-daintree-400",
            )}
          >
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
