import { Rocket } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { KASSEAL_LABELS } from "./labels";

export interface LaunchpadActionProps {
  /** Ledger cannot trade: the action stays focusable so its tooltip can explain why. */
  disabled: boolean;
  onOpen: () => void;
  onHintChange: (shown: boolean) => void;
  tooltipId: string;
}

export default function LaunchpadAction({
  disabled,
  onOpen,
  onHintChange,
  tooltipId,
}: LaunchpadActionProps) {
  const hint = (shown: boolean) => () => {
    if (disabled) onHintChange(shown);
  };
  return (
    <button
      type="button"
      // aria-disabled, not disabled: a disabled button gets no hover or focus,
      // and the tooltip is the only explanation a Ledger user gets.
      aria-disabled={disabled}
      className={twMerge(
        "flex flex-col items-center gap-2",
        disabled && "cursor-not-allowed opacity-40",
      )}
      onClick={() => {
        if (!disabled) onOpen();
      }}
      onMouseEnter={hint(true)}
      onMouseLeave={hint(false)}
      onFocus={hint(true)}
      onBlur={hint(false)}
      data-tooltip-id={tooltipId}
      data-tooltip-content={KASSEAL_LABELS.ledgerUnsupported}
    >
      <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
        <Rocket size={20} className="text-white" />
      </div>
      <span className="text-daintree-400">
        {KASSEAL_LABELS.dashboardAction}
      </span>
    </button>
  );
}
