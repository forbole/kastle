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

// The History | Token info control on top of every tabbed asset detail page.
export default function AssetTabs({ active, onChange }: Props) {
  return (
    <nav className="flex gap-x-1 rounded-xl bg-daintree-800 p-1">
      {TABS.map(({ tab, label }) => (
        <button
          key={tab}
          type="button"
          className={twMerge(
            "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-[#E5E7EB] focus:outline-none disabled:pointer-events-none disabled:opacity-50",
            active === tab ? "bg-daintree-700" : "bg-transparent",
          )}
          onClick={() => onChange(tab)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
