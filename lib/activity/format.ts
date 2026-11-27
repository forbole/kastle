// Token amount display shared by the Activity rows and the swap toasts. Pure:
// no assets, no React, so a hook can import it without the adapters' images.

// Built once: constructing an Intl formatter costs ~50x a format() call, and
// every Activity render formats every row.
const TINY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const AMOUNT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** Dashboard parity with mobile's formatNumber: at most 3 fraction digits. */
export function fmtAmount(value: string): string {
  if (!value) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  // A true non-zero amount under 0.001 (e.g. 0.0004 KAS) would round to a false
  // "0" at 3dp. Show up to 8 decimals instead (>= 5 significant for anything
  // down to 0.00001), bounded so a 36-decimal raw value never prints in full.
  if (n !== 0 && Math.abs(n) < 0.001) {
    const tiny = TINY.format(n);
    return Number(tiny) === 0 ? `${n < 0 ? "-" : ""}<0.00000001` : tiny;
  }
  return AMOUNT.format(n);
}
