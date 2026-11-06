import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import React, { useLayoutEffect, useRef, useState } from "react";
import Layer2AssetImage from "@/components/Layer2AssetImage";

/** The dashboard row's body, shared by both KCC-20 families. */
export type TokenRowProps = {
  logo?: string;
  ticker: React.ReactNode;
  /** Unit price; omitted when no market prices the token. */
  price?: string;
  balance: string;
  /** Shorter form, used only when the full balance would truncate the ticker. */
  compactBalance?: string;
  /** Holding value; omitted when there is no price to value it at. */
  fiat?: string;
};

// As mobile: ticker over unit price, balance over fiat. Nothing more on a list row.
export default function TokenRow({
  logo,
  ticker,
  price,
  balance,
  compactBalance,
  fiat,
}: TokenRowProps) {
  const tickerRef = useRef<HTMLSpanElement>(null);
  const balanceRef = useRef<HTMLSpanElement>(null);
  // The full figure it was compacted for, so a new balance is measured afresh.
  const [compactedFor, setCompactedFor] = useState<string>();
  const compact = compactBalance !== undefined && compactedFor === balance;

  // Measured, not guessed: compact only once the ticker actually truncates.
  // Styles and the webfont land after mount, so re-check when either does.
  useLayoutEffect(() => {
    const el = tickerRef.current;
    if (!el || compactBalance === undefined || compactedFor === balance) return;
    // Only the balance's fault counts: a long ticker beside a short figure
    // truncates on its own, and compacting the figure would not save it.
    const check = () => {
      const figure = balanceRef.current?.offsetWidth ?? 0;
      if (el.scrollWidth > el.clientWidth && figure > el.scrollWidth)
        setCompactedFor(balance);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    let active = true;
    document.fonts?.ready.then(() => active && check());
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [balance, compactBalance, compactedFor]);

  return (
    <>
      <div className="shrink-0">
        <Layer2AssetImage tokenImage={logo} chainImage={kasIcon} />
      </div>
      <div className="flex min-w-0 flex-grow items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span
            ref={tickerRef}
            data-part="ticker"
            className="truncate text-base text-white"
          >
            {ticker}
          </span>
          {price !== undefined && (
            <span className="truncate text-sm text-daintree-400">{price}</span>
          )}
        </div>
        {/* Its own column: a long balance never wraps nor shoves the ticker. */}
        <div
          data-part="balance"
          className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap text-right tabular-nums"
        >
          <span
            ref={balanceRef}
            className="text-base text-white"
            title={compact ? balance : undefined}
          >
            {compact ? compactBalance : balance}
          </span>
          {fiat !== undefined && (
            <span className="text-sm text-daintree-400">{fiat}</span>
          )}
        </div>
      </div>
    </>
  );
}
