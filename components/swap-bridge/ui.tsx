import React, { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  Check,
  Search,
} from "lucide-react";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import toast from "@/components/Toast";
import useStorageState from "@/hooks/useStorageState";
import { formatAmount } from "@/lib/format-amount";
import "/node_modules/flag-icons/css/flag-icons.min.css";

export function BottomSheet({
  title,
  subtitle,
  subtitleClassName,
  headerClassName,
  titleClassName,
  bodyClassName,
  open,
  onClose,
  children,
  footer,
  headerless,
  header,
  fixedHeight,
  tall,
}: {
  title: string;
  /** Figma 12472:58331: 14/20 Regular #7b9aaa caption directly under the title. */
  subtitle?: string;
  /** Override the caption style (Activity detail: 16px date, 8px under title). */
  subtitleClassName?: string;
  /** Override the header block / title padding (Activity detail: 16px inset). */
  headerClassName?: string;
  titleClassName?: string;
  /** Override the scrolling body (Activity detail: 16px side margin). */
  bodyClassName?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Figma sheet footer: divider + ⓘ + 12px note. */
  footer?: string;
  /** Figma token sheet: starts with its search field, no title row. */
  headerless?: boolean;
  /** Headerless only: fixed block above the scrolling list (the search). */
  header?: ReactNode;
  /** Figma token sheet: 542px in every state. */
  fixedHeight?: boolean;
  /** Figma provider / slippage sheets: 80px bottom space. */
  tall?: boolean;
}) {
  if (!open) return null;
  return (
    <Modal
      label={title}
      onCancel={onClose}
      onBackdropClick={onClose}
      className={twMerge(
        "max-h-[542px] rounded-t-2xl border border-daintree-700 bg-daintree-800 py-4 backdrop:bg-black/50",
        fixedHeight && "h-[542px]",
        tall && "pb-20",
      )}
    >
      {!headerless && (
        <div
          className={twMerge(
            "flex flex-col gap-2 px-2 pb-2 pt-4",
            headerClassName,
          )}
        >
          {subtitle ? (
            <div className="flex flex-col">
              <h2
                className={twMerge(
                  "pl-2 text-lg font-semibold tracking-[0.09px] text-gray-200",
                  titleClassName,
                )}
              >
                {title}
              </h2>
              <p
                className={twMerge(
                  "pl-2 text-sm tracking-[0.07px] text-daintree-400",
                  subtitleClassName,
                )}
              >
                {subtitle}
              </p>
            </div>
          ) : (
            <h2
              className={twMerge(
                "pl-2 text-lg font-semibold tracking-[0.09px] text-gray-200",
                titleClassName,
              )}
            >
              {title}
            </h2>
          )}
          <div className="py-2">
            <div className="h-px w-full bg-daintree-700" />
          </div>
        </div>
      )}
      {headerless && header}
      <div
        className={twMerge(
          "no-scrollbar flex min-h-0 flex-col gap-2 overflow-y-auto px-3 pb-4",
          // Figma 12500:352187: 6px row gap, list fixed at 440px with no
          // bottom padding so an 18px slice of the next row peeks.
          headerless && "max-h-[440px] gap-1.5 pb-0",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer && (
        <>
          <div className="p-2">
            <div className="h-px w-full bg-daintree-700" />
          </div>
          <div className="px-2">
            <div className="flex gap-3 p-3">
              <i className="hn hn-info-circle pt-0.5 text-xs text-daintree-400" />
              <p className="text-xs text-daintree-400">{footer}</p>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * Bottom-pinned native modal <dialog>: showModal() moves focus in, traps it
 * and makes the screen behind inert; close() hands focus back to the opener.
 * Escape fires onCancel.
 */
function Modal({
  label,
  onCancel,
  onBackdropClick,
  focusDialog,
  className,
  children,
}: {
  label: string;
  onCancel: () => void;
  onBackdropClick?: () => void;
  /** Focus the dialog itself instead of its first focusable child. */
  focusDialog?: boolean;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Layout effect: its cleanup runs while the dialog is still attached, so
  // close() can restore focus.
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    // showModal() focuses the first focusable child (a link, in the T&C gate).
    if (focusDialog) dialog.focus();
    return () => dialog.close();
  }, [focusDialog]);
  return (
    <dialog
      ref={ref}
      tabIndex={focusDialog ? -1 : undefined}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // Backdrop clicks target the dialog itself, above the sheet.
        if (
          e.target === e.currentTarget &&
          e.clientY < e.currentTarget.getBoundingClientRect().top
        )
          onBackdropClick?.();
      }}
      className={twMerge(
        "m-0 mt-auto w-full max-w-full flex-col text-inherit open:flex focus:outline-none",
        className,
      )}
    >
      {children}
    </dialog>
  );
}

export type Tooltip = { title: string; body: string; footer?: string };

/** A quote-card row; the info icon opens its explanation as a sheet. */
export function QuoteRow({
  label,
  tooltip,
  onClick,
  noChevron,
  infoOpensRow,
  children,
}: {
  label: string;
  tooltip?: Tooltip;
  onClick?: () => void;
  /** Figma: rows like Est. Fee show no › on the value. */
  noChevron?: boolean;
  /** Show the ⓘ and let it fire `onClick` (no explanation sheet). */
  infoOpensRow?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-daintree-700 px-4 py-3 text-sm first:border-t-0">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 text-left font-medium text-white"
        onClick={() => (tooltip ? setOpen(true) : infoOpensRow && onClick?.())}
      >
        {label}
        {(tooltip || infoOpensRow) && (
          <i className="hn hn-info-circle text-base" />
        )}
      </button>
      {onClick ? (
        <button
          type="button"
          className="flex flex-none items-center gap-1 whitespace-nowrap text-white"
          onClick={onClick}
        >
          {children}
          {!noChevron && <i className="hn hn-angle-right text-xs" />}
        </button>
      ) : (
        <div className="flex flex-none items-center gap-1 whitespace-nowrap text-white">
          {children}
        </div>
      )}
      {tooltip && (
        <BottomSheet
          title={tooltip.title}
          open={open}
          onClose={() => setOpen(false)}
          footer={tooltip.footer}
        >
          <p className="px-3 py-2 text-sm text-white">{tooltip.body}</p>
        </BottomSheet>
      )}
    </div>
  );
}

export const Skeleton = () => (
  <span className="h-4 w-20 animate-pulse rounded-lg bg-daintree-700" />
);

/** The arrow between the two token pills (Figma: 20px icon in a 46px slot). */
export const PairArrow = () => (
  <span className="flex size-[46px] flex-none items-center justify-center">
    <ArrowRight size={20} strokeWidth={1.5} className="text-daintree-400" />
  </span>
);

export function TokenPill({
  symbol,
  tokenImage,
  chainImage,
  onClick,
  hug,
}: {
  symbol: string;
  tokenImage?: string;
  chainImage?: string;
  onClick?: () => void;
  /** Size to the content instead of filling the row. */
  hug?: boolean;
}) {
  return (
    <button
      type="button"
      className={twMerge(
        "flex h-[46px] min-w-0 items-center justify-center gap-2 rounded-full bg-white/10 px-3 text-white",
        !hug && "flex-1",
      )}
      onClick={onClick}
    >
      {/* mr: the 12px chain badge overhangs the 20px token by 7px */}
      {/* Badge drawn here, not via Layer2AssetImage: its border colour is fixed
          to the sheet's #102832, and this badge's must match the pill —
          white/10 over the page bg #051d27 = solid #1e343d. */}
      <span className="relative mr-[7px] flex">
        <img
          src={tokenImage ?? kasIcon}
          alt=""
          onError={(e) => (e.currentTarget.src = kasIcon)}
          className="size-5 rounded-full object-cover"
        />
        <img
          src={chainImage ?? kasIcon}
          alt=""
          className="absolute -right-[7px] bottom-0 size-3 rounded-full border border-[#1e343d] bg-[#1e343d] object-cover"
        />
      </span>
      <span className="truncate text-base font-medium">{symbol}</span>
      <i className="hn hn-angle-down flex-none text-xl" />
    </button>
  );
}

/** Figma "Amount Info": centered digit + logo + ticker, fiat below, flip right-aligned. */
export function AmountInput({
  value,
  onChange,
  symbol,
  tokenImage,
  chainImage,
  usd,
  onFlip,
  flipDisabled,
}: {
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  tokenImage?: string;
  chainImage?: string;
  usd?: string;
  onFlip: () => void;
  flipDisabled?: boolean;
}) {
  // Figma "Amount length variants": 36 / 30 / 24 / 20px at ~12 / 14 / 17 / 21 chars.
  const textSize =
    value.length > 17
      ? "text-xl"
      : value.length > 14
        ? "text-2xl"
        : value.length > 12
          ? "text-3xl"
          : "text-4xl";
  // Fiat line follows the amount's steps: 16 / 14 / 13 / 12px, 12px floor.
  const usdSize =
    value.length > 17
      ? "text-xs"
      : value.length > 14
        ? "text-[13px]"
        : value.length > 12
          ? "text-sm"
          : "text-base";
  // A "." is about half a digit wide; counting it as a full `ch` left a gap
  // between the number and the token icon.
  const widthCh = Math.max(
    value.replace(".", "").length + (value.includes(".") ? 0.5 : 0),
    1,
  );
  return (
    <div className="flex flex-col items-center pt-2">
      <div className="flex max-w-full items-center justify-center gap-2.5">
        <input
          inputMode="decimal"
          placeholder="0"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (/^\d*\.?\d*$/.test(v)) onChange(v);
          }}
          // ponytail: ch-width hugs the digits; swap for `field-sizing: content` once Firefox ships it
          style={{ width: `${widthCh}ch` }}
          className={twMerge(
            "min-w-0 border-none bg-transparent p-0 text-center font-semibold text-white placeholder:text-white focus:ring-0",
            textSize,
          )}
        />
        {symbol && (
          <div className="flex flex-none items-center gap-2 pt-0.5">
            <div className="relative">
              <img
                src={tokenImage ?? kasIcon}
                alt={symbol}
                onError={(e) => (e.currentTarget.src = kasIcon)}
                className="size-10 rounded-full object-cover"
              />
              <img
                src={chainImage ?? kasIcon}
                alt=""
                className="absolute bottom-0 left-[30px] size-4 rounded-full border-2 border-icy-blue-950 bg-black object-cover"
              />
            </div>
            <span className="text-xl font-semibold text-daintree-300">
              {symbol}
            </span>
          </div>
        )}
      </div>
      {usd && (
        <div
          className={twMerge(
            "mt-3 flex max-w-full items-center text-daintree-300",
            usdSize,
          )}
        >
          <span className="min-w-0 truncate">{usd}</span>
          <span
            className={twMerge(
              "flex flex-none items-center gap-1.5 px-2 py-1.5 font-medium",
              usdSize === "text-base" && "text-sm",
            )}
          >
            <span className="fi fi-us fis rounded-full" />
            USD
          </span>
        </div>
      )}
      <div className="flex w-full justify-end">
        <button
          type="button"
          aria-label="Flip"
          disabled={flipDisabled}
          onClick={onFlip}
          className="flex size-[38px] items-center justify-center rounded-full bg-white/10 disabled:opacity-40"
        >
          <ArrowUpDown size={16} strokeWidth={1.5} className="text-white" />
        </button>
      </div>
    </div>
  );
}

/** Figma 13024:157027 bottom (pinned): error → Balance row (+ Max) → Confirm, 12px apart. */
export function ConfirmButton({
  error,
  balance,
  onMax,
  disabled,
  loading,
  onClick,
}: {
  error?: string;
  /** Pre-formatted, with symbol, e.g. "2,000.24 KAS". */
  balance?: string;
  onMax?: () => void;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-none flex-col gap-3 bg-icy-blue-950 pb-3 pt-2">
      {error && (
        <p className="flex items-center justify-center gap-2 px-4 text-center text-sm font-medium text-red-500">
          <AlertCircle size={16} className="flex-none" />
          {error}
        </p>
      )}
      {balance !== undefined && (
        <div className="flex items-center gap-3 bg-[#061e28] px-4 py-2 text-sm">
          <p className="flex min-w-0 flex-1 gap-2">
            <span className="font-semibold text-white">Balance</span>
            <span className="truncate text-white">{balance}</span>
          </p>
          {onMax && (
            <button
              type="button"
              onClick={onMax}
              className="h-[38px] rounded-lg bg-white/10 px-3 text-[15px] font-semibold text-white"
            >
              Max
            </button>
          )}
        </div>
      )}
      <div className="px-4">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 px-4 py-3.5 text-[15px] font-semibold text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-daintree-600"
          disabled={disabled || loading}
          onClick={onClick}
        >
          {loading && (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          Confirm
        </button>
      </div>
    </div>
  );
}

/** Figma provider row: plain row, 40px logo, outline badge, checkbox on the right. */
export function ProviderRow({
  image,
  name,
  subtitle,
  selected,
  recommended,
  disabled,
  onClick,
}: {
  image?: string;
  name: string;
  subtitle: string;
  selected: boolean;
  recommended?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-left disabled:opacity-40"
    >
      <img src={image} alt="" className="size-10 flex-none rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-white">{name}</span>
        <span className="text-xs text-daintree-400">{subtitle}</span>
      </div>
      {recommended && (
        <span className="rounded-full border border-icy-blue-600 px-[3px] py-px text-[10px] font-medium leading-4 text-icy-blue-400">
          <span className="px-[2.5px]">Recommended</span>
        </span>
      )}
      <span
        role="checkbox"
        aria-checked={selected}
        className={twMerge(
          "flex size-4 flex-none items-center justify-center rounded border",
          selected
            ? "border-icy-blue-400 bg-icy-blue-400"
            : "border-daintree-700",
        )}
      >
        {selected && <Check size={14} className="text-white" />}
      </span>
    </button>
  );
}

/** Pre-first-use T&C gate (Figma "Dropdown Menu/bottom sheet"); Cancel leaves the flow. */
export function TermsGate({ kind }: { kind: "Swap" | "Bridge" }) {
  const navigate = useNavigate();
  const [accepted, setAccepted, loading] = useStorageState(
    `local:${kind.toLowerCase()}_terms_accepted`,
    false,
  );
  const [checked, setChecked] = useState(false);
  if (loading || accepted) return null;
  return (
    <Modal
      label={`${kind} Terms & Conditions`}
      // Escape is Cancel: the gate must not just vanish.
      onCancel={() => navigate("/dashboard")}
      focusDialog
      className="max-h-full rounded-t-2xl border border-daintree-700 bg-daintree-800 py-4 drop-shadow-lg backdrop:bg-transparent"
    >
      <div className="px-2 pb-2 pt-4">
        <h2 className="pl-2 text-lg font-semibold text-gray-200">
          {kind} Terms & Conditions
        </h2>
      </div>
      <div className="py-2">
        <div className="h-px w-full bg-daintree-700" />
      </div>
      <div className="flex items-center justify-between gap-2 px-6 pb-10 pt-2 text-sm text-white">
        <span>
          I have read and agree to the {kind}{" "}
          <a
            href="https://kastle.cc/term-and-conditions"
            target="_blank"
            rel="noreferrer"
            className="text-icy-blue-400 underline"
          >
            T&C
          </a>
          .
        </span>
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`Agree to the ${kind} T&C`}
          onClick={() => setChecked(!checked)}
          className={twMerge(
            "flex size-4 flex-none items-center justify-center rounded border",
            checked
              ? "border-icy-blue-400 bg-icy-blue-400"
              : "border-daintree-400",
          )}
        >
          {checked && <Check size={14} className="text-white" />}
        </button>
      </div>
      <div className="flex items-center gap-3 px-4 pb-6 pt-3">
        <button
          type="button"
          className="rounded-lg px-5 py-[22px] text-[15px] font-semibold text-daintree-400"
          onClick={() => navigate("/dashboard")}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!checked}
          onClick={() =>
            setAccepted(true).catch(() =>
              toast.error("Couldn't save your choice. Please try again."),
            )
          }
          className="flex-1 rounded-full bg-icy-blue-400 px-4 py-3.5 text-[15px] font-semibold text-white disabled:bg-icy-blue-700/30 disabled:text-white/20"
        >
          Confirm
        </button>
      </div>
    </Modal>
  );
}

export type SheetToken = {
  key: string;
  chain: string;
  symbol: string;
  address?: string;
  image?: string;
  chainImage?: string;
  balance?: string;
  disabled?: boolean;
};

/** Token picker: chain chips, search by symbol/address, recent picks first. */
export function TokenSheet({
  open,
  onClose,
  chains,
  chain,
  onChain,
  tokens,
  onSelect,
  recentKey,
}: {
  open: boolean;
  onClose: () => void;
  chains: { key: string; label: string; image?: string }[];
  chain: string;
  onChain: (key: string) => void;
  tokens: SheetToken[];
  onSelect: (token: SheetToken) => void;
  recentKey: `local:${string}`;
}) {
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useStorageState<string[]>(recentKey, []);
  const q = search.trim().toLowerCase();
  const inChain = tokens.filter((t) => t.chain === chain);
  const matches = inChain.filter(
    (t) =>
      !q ||
      t.symbol.toLowerCase().includes(q) ||
      t.address?.toLowerCase().includes(q),
  );
  const recentTokens = q
    ? []
    : recent
        .map((k) => inChain.find((t) => t.key === k))
        .filter((t): t is SheetToken => !!t);

  const row = (t: SheetToken) => (
    <button
      key={t.key}
      type="button"
      disabled={t.disabled}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-daintree-700 disabled:opacity-40"
      onClick={() => {
        // Recents are a nicety: a failed write must not block the pick.
        setRecent((prev) =>
          [t.key, ...prev.filter((k) => k !== t.key)].slice(0, 5),
        ).catch(console.error);
        onSelect(t);
        onClose();
      }}
    >
      <Layer2AssetImage
        tokenImage={t.image}
        chainImage={t.chainImage}
        tokenImageSize={40}
        // Layer2AssetImage adds 2px border per side: 16 image + border = 20 box.
        chainImageSize={16}
        chainImageBottomPosition={-2}
        chainImageRightPosition={-8}
      />
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-white">{t.symbol}</span>
        {t.address && (
          <span className="text-xs text-daintree-400">
            {t.address.slice(0, 6)}…{t.address.slice(-4)}
          </span>
        )}
      </div>
      {t.balance !== undefined && (
        <span className="text-sm font-semibold text-white">{t.balance}</span>
      )}
    </button>
  );

  return (
    <BottomSheet
      title="Select Token"
      open={open}
      onClose={onClose}
      headerless
      fixedHeight
      header={
        <div className="px-4 pb-3">
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-daintree-400"
            />
            <input
              placeholder="Search token"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[46px] w-full rounded-lg border border-daintree-700 bg-icy-blue-950 py-0 pl-11 pr-4 text-[15px] font-medium text-white shadow-sm placeholder:text-daintree-400 focus:border-daintree-600 focus:ring-0"
            />
          </div>
        </div>
      }
    >
      {chains.length > 1 && (
        <div className="flex gap-2 pb-2">
          {chains.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChain(c.key)}
              className={twMerge(
                "flex h-9 items-center gap-2 rounded-xl border bg-daintree-700 px-3 text-sm font-medium text-gray-200",
                c.key === chain ? "border-icy-blue-400" : "border-transparent",
              )}
            >
              {c.image && (
                <img src={c.image} alt="" className="size-5 rounded-full" />
              )}
              {c.label}
            </button>
          ))}
        </div>
      )}
      {recentTokens.length > 0 && <>{recentTokens.map(row)}</>}
      {matches.filter((t) => !recentTokens.includes(t)).map(row)}
      {matches.length === 0 && (
        <p className="py-4 text-center text-sm text-daintree-400">
          No tokens found
        </p>
      )}
    </BottomSheet>
  );
}

export { formatAmount };

/** USD display: sub-cent values round to 0.00 at 2 decimals, so show more. */
export const formatUsd = (n: number) =>
  Number.isFinite(n) && n !== 0 && Math.abs(n) < 0.01
    ? // Significant digits, so any non-zero amount stays visibly non-zero.
      `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", {
        minimumSignificantDigits: 2,
        maximumSignificantDigits: 5,
        maximumFractionDigits: 20,
      })}`
    : formatAmount(n, 2);
