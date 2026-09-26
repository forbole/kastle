import React, { ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { ArrowUpDown, Check } from "lucide-react";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import useStorageState from "@/hooks/useStorageState";

export function BottomSheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85%] flex-col gap-4 rounded-t-2xl border border-daintree-700 bg-daintree-800 p-6">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-white">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <i className="hn hn-times text-xl text-daintree-400" />
          </button>
        </div>
        <div className="no-scrollbar flex flex-col gap-2 overflow-y-auto">
          {children}
        </div>
      </div>
    </>
  );
}

export type Tooltip = { title: string; body: string; footer?: string };

/** A quote-card row; the info icon opens its explanation as a sheet. */
export function QuoteRow({
  label,
  tooltip,
  onClick,
  children,
}: {
  label: string;
  tooltip?: Tooltip;
  onClick?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <button
        type="button"
        className="flex items-center gap-1 text-daintree-400"
        onClick={() => tooltip && setOpen(true)}
      >
        {label}
        {tooltip && <i className="hn hn-info-circle text-xs" />}
      </button>
      <div
        className={twMerge(
          "flex items-center gap-1 text-white",
          onClick && "cursor-pointer",
        )}
        onClick={onClick}
      >
        {children}
        {onClick && <i className="hn hn-angle-right text-xs" />}
      </div>
      {tooltip && (
        <BottomSheet
          title={tooltip.title}
          open={open}
          onClose={() => setOpen(false)}
        >
          <p className="text-sm text-daintree-400">{tooltip.body}</p>
          {tooltip.footer && (
            <p className="text-xs text-daintree-500">{tooltip.footer}</p>
          )}
        </BottomSheet>
      )}
    </div>
  );
}

export const Skeleton = () => (
  <span className="h-4 w-20 animate-pulse rounded-lg bg-daintree-700" />
);

export function TokenPill({
  symbol,
  tokenImage,
  chainImage,
  onClick,
}: {
  symbol: string;
  tokenImage?: string;
  chainImage?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="flex flex-1 items-center gap-2 rounded-full border border-daintree-700 bg-daintree-800 px-3 py-2 text-white"
      onClick={onClick}
    >
      <Layer2AssetImage
        tokenImage={tokenImage}
        chainImage={chainImage}
        tokenImageSize={24}
        chainImageSize={12}
        chainImageBottomPosition={-2}
      />
      <span className="flex-1 truncate text-left text-sm font-semibold">
        {symbol}
      </span>
      <i className="hn hn-angle-down text-xs text-daintree-400" />
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
  balance,
  onMax,
  onFlip,
  flipDisabled,
}: {
  value: string;
  onChange: (v: string) => void;
  symbol: string;
  tokenImage?: string;
  chainImage?: string;
  usd?: string;
  balance?: string;
  onMax?: () => void;
  onFlip: () => void;
  flipDisabled?: boolean;
}) {
  const textSize =
    value.length > 14
      ? "text-xl"
      : value.length > 11
        ? "text-2xl"
        : value.length > 8
          ? "text-3xl"
          : "text-4xl";
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
          style={{ width: `${Math.max(value.length, 1)}ch` }}
          className={twMerge(
            "min-w-0 border-none bg-transparent p-0 text-center font-semibold text-white placeholder:text-daintree-600 focus:ring-0",
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
            <span className="text-xl font-semibold text-[#9eb7c4]">
              {symbol}
            </span>
          </div>
        )}
      </div>
      {usd && <span className="mt-3 text-base text-[#9eb7c4]">{usd}</span>}
      {balance !== undefined && (
        <button
          type="button"
          className="mt-1 text-xs text-daintree-400"
          onClick={onMax}
        >
          Balance: {balance} {symbol}
          {onMax && <span className="ml-1 text-icy-blue-400">Max</span>}
        </button>
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

export function ConfirmButton({
  error,
  disabled,
  loading,
  onClick,
}: {
  error?: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-auto flex flex-col gap-2 pb-2">
      {error && <p className="text-center text-sm text-red-500">{error}</p>}
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
        disabled={disabled || loading}
        onClick={onClick}
      >
        {loading && (
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        Confirm
      </button>
    </div>
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
    <>
      <div className="fixed inset-0 z-40" />
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border border-daintree-700 bg-daintree-800 py-4 drop-shadow-lg">
        <div className="px-2 pb-2 pt-4">
          <h2 className="pl-2 text-lg font-semibold text-gray-200">
            {kind} Terms & Conditions
          </h2>
        </div>
        <div className="py-2">
          <div className="h-px w-full bg-daintree-700" />
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg px-3 pb-10 pt-2 text-sm text-white">
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
        <div className="flex flex-col px-4 pb-6 pt-3">
          <button
            type="button"
            disabled={!checked}
            onClick={() => setAccepted(true)}
            className="w-full rounded-full bg-icy-blue-400 px-4 py-3.5 text-[15px] font-semibold text-white disabled:bg-icy-blue-700/30 disabled:text-white/20"
          >
            Confirm
          </button>
          <button
            type="button"
            className="w-full rounded-lg px-5 py-[22px] text-[15px] font-semibold text-daintree-400"
            onClick={() => navigate("/dashboard")}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
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
  chains: { key: string; label: string }[];
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
      className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-daintree-700 disabled:opacity-40"
      onClick={() => {
        void setRecent((prev) =>
          [t.key, ...prev.filter((k) => k !== t.key)].slice(0, 5),
        );
        onSelect(t);
        onClose();
      }}
    >
      <Layer2AssetImage
        tokenImage={t.image}
        chainImage={t.chainImage}
        tokenImageSize={32}
        chainImageSize={14}
        chainImageBottomPosition={-2}
      />
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-semibold text-white">{t.symbol}</span>
        {t.address && (
          <span className="text-xs text-daintree-400">
            {t.address.slice(0, 6)}…{t.address.slice(-4)}
          </span>
        )}
      </div>
      {t.balance !== undefined && (
        <span className="text-sm text-daintree-400">{t.balance}</span>
      )}
    </button>
  );

  return (
    <BottomSheet title="Select Token" open={open} onClose={onClose}>
      <input
        placeholder="Search token"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border border-daintree-700 bg-daintree-900 px-3 py-2 text-sm text-white placeholder:text-daintree-500 focus:border-daintree-600 focus:ring-0"
      />
      {chains.length > 1 && (
        <div className="flex gap-2">
          {chains.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChain(c.key)}
              className={twMerge(
                "rounded-full border px-3 py-1 text-xs",
                c.key === chain
                  ? "border-icy-blue-400 bg-icy-blue-400/10 text-icy-blue-400"
                  : "border-daintree-700 text-daintree-400",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {recentTokens.length > 0 && (
        <>
          <span className="text-xs text-daintree-500">Recent</span>
          {recentTokens.map(row)}
          <span className="text-xs text-daintree-500">All tokens</span>
        </>
      )}
      {matches.map(row)}
      {matches.length === 0 && (
        <p className="py-4 text-center text-sm text-daintree-400">
          No tokens found
        </p>
      )}
    </BottomSheet>
  );
}

export const formatAmount = (n: number, max = 6) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: max })
    : "0";
