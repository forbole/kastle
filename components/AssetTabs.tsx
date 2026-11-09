import { useRef } from "react";
import { twMerge } from "tailwind-merge";

export type AssetTab = "history" | "info";

type Props = {
  active: AssetTab;
  onChange: (tab: AssetTab) => void;
};

const TABS: { tab: AssetTab; label: string }[] = [
  { tab: "history", label: "History" },
  { tab: "info", label: "Token info" },
];

/** Ids a page wires its tab panel to: `aria-labelledby={assetTabId(tab)}`. */
export const assetTabId = (tab: AssetTab) => `asset-tab-${tab}`;
export const assetPanelId = (tab: AssetTab) => `asset-panel-${tab}`;

// The History | Token info control on top of every tabbed asset detail page.
// Real tabs: one tab stop, arrows / Home / End move and select.
export default function AssetTabs({ active, onChange }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = TABS.length - 1;
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
    onChange(TABS[next].tab);
  };

  return (
    // --prevent-on-load-init: Preline's HSTabs autoInit claims [role=tablist]
    // and throws when no child carries its `active` class; this one is React's.
    <nav
      role="tablist"
      aria-label="Asset details"
      className="--prevent-on-load-init flex gap-x-1 rounded-xl bg-daintree-800 p-1"
    >
      {TABS.map(({ tab, label }, index) => (
        <button
          key={tab}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="tab"
          id={assetTabId(tab)}
          aria-controls={assetPanelId(tab)}
          aria-selected={active === tab}
          tabIndex={active === tab ? 0 : -1}
          className={twMerge(
            "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-[#E5E7EB] focus:outline-none disabled:pointer-events-none disabled:opacity-50",
            active === tab ? "bg-daintree-700" : "bg-transparent",
          )}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
