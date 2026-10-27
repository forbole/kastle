import { twMerge } from "tailwind-merge";
import AssetImage from "./AssetImage";
import type { NetworkType } from "./labels";

export interface TokenItemProps {
  name: string;
  /** Secondary line: the price on Home, a shortened covenant id / contract address on Send. */
  subtitle?: string;
  /** Display-ready balance (the caller masks it when balances are hidden). */
  amount?: string;
  amountFiat?: string;
  logo?: string;
  fallback?: string;
  /** Picks the corner badge; Figma tells same-symbol rows apart by badge alone, no chip. */
  network?: NetworkType;
  /** list = Send token picker row; card = Home asset row. */
  variant?: "list" | "card";
  disabled?: boolean;
  onClick?: () => void;
}

export default function TokenItem({
  name,
  subtitle,
  amount,
  amountFiat,
  logo,
  fallback,
  network,
  variant = "list",
  disabled = false,
  onClick,
}: TokenItemProps) {
  const isCard = variant === "card";

  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      onClick={onClick}
      className={twMerge(
        "flex w-full items-center gap-3 text-left disabled:cursor-default",
        isCard
          ? "rounded-2xl border border-card-border bg-white/5 px-3 py-3 enabled:hover:border-white"
          : "rounded-lg py-3.5 enabled:hover:bg-daintree-800",
        disabled && "opacity-40",
      )}
    >
      <AssetImage
        variant="chain"
        tokenImage={logo}
        fallback={fallback}
        network={network}
      />

      <div
        className={twMerge(
          "flex min-w-0 flex-1 flex-col",
          isCard ? "gap-1.5" : "gap-1",
        )}
      >
        <span
          className={twMerge(
            "truncate text-base",
            isCard
              ? "font-semibold leading-4 text-white"
              : "leading-5 text-daintree-200",
          )}
        >
          {name}
        </span>
        {subtitle && (
          <span
            className={twMerge(
              "truncate",
              isCard
                ? "text-sm leading-[21px] text-daintree-300"
                : "text-xs tracking-[0.06px] text-daintree-400",
            )}
          >
            {subtitle}
          </span>
        )}
      </div>

      {amount !== undefined && (
        <div className="flex max-w-[50%] shrink-0 flex-col items-end gap-1.5 text-right">
          <span
            className={twMerge(
              "max-w-full truncate text-base",
              isCard
                ? "font-semibold leading-4 text-white"
                : "text-daintree-200",
            )}
          >
            {amount}
          </span>
          {amountFiat && (
            <span className="text-sm leading-[21px] text-daintree-300">
              {amountFiat}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
