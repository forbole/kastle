import { twMerge } from "tailwind-merge";
import { NETWORK_TYPE_LABELS, NetworkType } from "./labels";

export interface NetworkTypeChipProps {
  network: NetworkType;
  /** Optional 14px glyph before the label. */
  icon?: string;
}

/** Outline pill; KCC-20 uses the kcc20.text / kcc20.background pair, every other network the info pair. */
export default function NetworkTypeChip({
  network,
  icon,
}: NetworkTypeChipProps) {
  return (
    <span
      className={twMerge(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-4",
        network === "kcc20"
          ? "border-kcc20-text bg-kcc20-background text-kcc20-text"
          : "border-icy-blue-500 bg-info-background text-icy-blue-200",
      )}
    >
      {icon && (
        <img alt="" src={icon} className="size-3.5 rounded-full object-cover" />
      )}
      {NETWORK_TYPE_LABELS[network]}
    </span>
  );
}
