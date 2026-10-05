import React, { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRightLeft, History } from "lucide-react";
import { twMerge } from "tailwind-merge";
import homeIcon from "@/assets/images/home.svg";
import homeFilledIcon from "@/assets/images/home-filled.svg";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import HoverTooltip from "@/components/HoverTooltip";

// Icon Park outline "bridge-two": the shape Figma renders for its
// `icon-park-outline:bridge-one` layer (Iconify's bridge-one is an arch).
const BridgeIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 13s6 10 16 10s16-10 16-10" />
    <path d="M8 10v28m32-28v28" />
    <path d="M4 30.5s12.188-.597 20-.5c7.82.098 20 1 20 1M16 21v9m8-7v7m8-9v9M8 13l-4 5m40 0l-4-5" />
  </svg>
);

const TABS: [string, string, (active: boolean) => ReactNode][] = [
  [
    "/dashboard",
    "Home",
    (active) => (
      <img alt="" className="size-6" src={active ? homeFilledIcon : homeIcon} />
    ),
  ],
  ["/swap", "Swap", () => <ArrowRightLeft size={24} strokeWidth={1.5} />],
  ["/bridge", "Bridge", () => <BridgeIcon />],
];

/**
 * Top-right Activity shortcut for Swap and Bridge (mobile parity: the history
 * icon in the screen header). Opens the Activity page for that screen.
 */
export function ActivityHeaderButton({ type }: { type: "swap" | "bridge" }) {
  const navigate = useNavigate();
  const { isActivityEnabled } = useFeatureFlags();
  if (!isActivityEnabled) return null;
  return (
    <button
      type="button"
      aria-label="Activity"
      title="Activity"
      onClick={() => navigate(`/activity?type=${type}`)}
      // Sits over GeneralHeader's empty right slot (same p-3 + 20px box), so
      // the title stays centred.
      className="absolute right-4 top-4 rounded-lg p-3 text-white hover:bg-daintree-800"
    >
      <History size={20} strokeWidth={1.5} />
    </button>
  );
}

/** Bottom action bar shown on Dashboard, Swap, Bridge and Activity (Figma "Tab bar / V2"). */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isSwapEnabled, isBridgeEnabled } = useFeatureFlags();
  const { wallet } = useWalletManager();
  const isLedger = wallet?.type === "ledger";

  const tabs = TABS.filter(
    ([path]) =>
      (path !== "/swap" || isSwapEnabled) &&
      (path !== "/bridge" || isBridgeEnabled),
  );

  return (
    <div className="bg-icy-blue-950 pb-3">
      <div className="flex h-[54px] justify-between border-t border-daintree-800 px-2 shadow-[0_3px_20px_-4px_rgba(10,10,10,0.1)]">
        {tabs.map(([path, label, icon]) => {
          const active = pathname === path;
          const gated = isLedger && (path === "/swap" || path === "/bridge");
          // Figma's Swap frame reads "Bridge" (copy-paste leftover); use the tab's own label.
          const message = `Ledger doesn't support ${label} function currently.`;
          const button = (
            <button
              key={path}
              type="button"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              aria-disabled={gated ? "true" : undefined}
              title={gated ? message : undefined}
              onClick={() => !gated && navigate(path)}
              className={twMerge(
                "flex w-[70px] justify-center px-4 pb-3 pt-[18px]",
                active ? "text-[#00C4E7]" : "text-white",
                gated && "cursor-default opacity-20",
              )}
            >
              {icon(active)}
            </button>
          );
          return gated ? (
            <HoverTooltip
              key={path}
              id={`ledger-${label.toLowerCase()}`}
              place="top"
              openOnFocus
              text={message}
              style={{
                fontSize: 14,
                lineHeight: "20px",
                fontWeight: 500,
                padding: "8px 10px",
                borderRadius: 4,
                color: "#ffffff",
              }}
            >
              {button}
            </HoverTooltip>
          ) : (
            button
          );
        })}
      </div>
    </div>
  );
}
