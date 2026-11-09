import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import React, { useLayoutEffect, useRef, useState } from "react";
import Layer2AssetImage from "@/components/Layer2AssetImage";

/** The dashboard row's body: KAS, KRC-20 and both KCC-20 families. */
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
  const fiatRef = useRef<HTMLSpanElement>(null);
  // The full figure it was compacted for, so a new balance is measured afresh.
  const [compactedFor, setCompactedFor] = useState<string>();
  const compact = compactBalance !== undefined && compactedFor === balance;

  // Measured, not guessed: compact only once the ticker actually truncates.
  // Styles and the webfont land after mount, so re-check when either does.
  useLayoutEffect(() => {
    const el = tickerRef.current;
    if (!el || compactBalance === undefined || compactedFor === balance) return;
    // Compact when the balance is to blame: it is wider than the ticker, or
    // compacting it gives back at least the ticker's overflow. Digits are
    // tabular, so the compact width scales with its length; the fiat line
    // keeps the column at least its own width. A long ticker beside a short
    // figure that compacting would not save is left truncated.
    const ratio = compactBalance.length / balance.length;
    const check = () => {
      const figure = balanceRef.current?.offsetWidth ?? 0;
      const fiatWidth = fiatRef.current?.offsetWidth ?? 0;
      const reclaim = figure - Math.max(figure * ratio, fiatWidth);
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow > 0 && (figure > el.scrollWidth || overflow <= reclaim))
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
            <span ref={fiatRef} className="text-sm text-daintree-400">
              {fiat}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
