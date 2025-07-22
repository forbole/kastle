import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SideMenu } from "@/components/side-menu/SideMenu.tsx";
import gavelIcon from "@/assets/images/gavel.svg";
import { formatCurrency, symbolForCurrencyCode } from "@/lib/utils.ts";
import { twMerge } from "tailwind-merge";
import useBackupWarning from "@/hooks/useBackupWarning.ts";
import useKeyring from "@/hooks/useKeyring.ts";
import useWalletManager from "@/hooks/useWalletManager.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { Tooltip } from "react-tooltip";
import Assets from "@/components/dashboard/Assets";
import KNS from "@/components/dashboard/KNS";
import KRC721List from "@/components/dashboard/KRC721List";
import useTotalBalance from "@/hooks/kasplex/useTotalBalance";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import usePortfolioPerformance from "@/hooks/usePortfolioPerformance";
import HoverTooltip from "../HoverTooltip";
import KNSText from "@/components/dashboard/KNSText.tsx";
import AddressesMenu from "../dashboard/AddressesMenu";

export default function Dashboard() {
  const { keyringLock } = useKeyring();
  const navigate = useNavigate();
  const { networkId, isConnected } = useRpcClientStateful();
  const [settings, setSettings] = useSettings();
  const totalBalance = useTotalBalance();
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(totalBalance);
  const { showWarning } = useBackupWarning();
  const { account, wallet } = useWalletManager();
  const [dismissWarning, setDismissWarning] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAddressesMenuOpen, setIsAddressesMenuOpen] = useState(false);

  const tabs = ["Assets", "NFT", "KNS", "Text"] as const;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Assets");
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  const segments = Array.from(segmenter.segment(account?.name ?? ""));
  const shortAccountName = `${segments[0]?.segment}${segments[segments.length - 1]?.segment}`;

  const showBalance = !settings?.hideBalances;
  const totalBalanceFormatted = formatCurrency(
    totalBalanceCurrency,
    currencyCode,
  );

  const { performance, performanceInPercent } = usePortfolioPerformance();

  const toggleBalance = () =>
    setSettings((prevSettings) => ({
      ...prevSettings,
      hideBalances: !prevSettings.hideBalances,
    }));

  const network = networkId ?? NetworkType.Mainnet;
  const isMainnet = network === NetworkType.Mainnet;

  const isLedger = wallet?.type === "ledger";
  const [deployHovered, setDeployHovered] = useState(false);
  const [mintHovered, setMintHovered] = useState(false);

  return (
    <div className="no-scrollbar relative flex h-full w-full flex-col overflow-y-scroll px-3">
      {/* Warning popup */}
      {showWarning && !dismissWarning && (
        <div
          className="absolute bottom-0 left-0 z-10 m-3 flex flex-col gap-2 rounded-xl border border-[#713F12] bg-[#281704] p-4 text-base"
          role="alert"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-daintree-200">
              ✋ Hold on, Your Majesty! 👑
            </span>
            <button type="button" onClick={() => setDismissWarning(true)}>
              <i className="hn hn-times text-[16px] text-[#854D0E]"></i>
            </button>
          </div>

          <span className="text-sm text-daintree-400">
            Please back up your recovery phrase 📜. It’s the 🗝️ key to accessing
            your Kastle if you lose your password or reinstall your browser or
            extension 🌐
          </span>
          <button
            onClick={() =>
              navigate(
                `/backup-unlock?redirect=/show-recovery-phrase/${wallet?.id}`,
              )
            }
            type="button"
            className="inline-flex items-center gap-x-2 self-start rounded-lg border border-transparent bg-[#854D0E]/30 px-4 py-3 text-sm font-medium text-[#EAB308] hover:bg-[#854D0E]/20 focus:bg-[#854D0E4D] focus:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            Back up now
            <i className="hn hn-angle-right"></i>
          </button>
        </div>
      )}

      {/* Side Menu */}
      <SideMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />

      {/* Header */}
      <div className="flex w-full items-center justify-between gap-4 py-4">
        <div className="relative flex cursor-pointer rounded-lg font-semibold">
          <div
            className="flex flex-1 items-center space-x-2 rounded-l-lg border border-gray-500 p-2 hover:border-white"
            onClick={() => setIsMenuOpen(true)}
          >
            <span className="flex size-6 items-center justify-center rounded-lg bg-daintree-400 text-white">
              {shortAccountName}
            </span>
            <span className="text-base text-white">{account?.name}</span>
          </div>
          <div
            className="flex cursor-pointer items-center rounded-r-lg border border-gray-500 hover:border-white"
            onClick={() => setIsAddressesMenuOpen(!isAddressesMenuOpen)}
          >
            <i className="hn hn-copy px-2 text-[16px] text-white" />
            <i className="hn hn-angle-down pr-2 text-daintree-400" />
          </div>

          {isAddressesMenuOpen && (
            <AddressesMenu onClose={() => setIsAddressesMenuOpen(false)} />
          )}
        </div>

        <div className="flex">
          <button
            className="p-3 text-white"
            onClick={() => navigate("/settings")}
          >
            <i className="hn hn-cog text-[20px]" />
          </button>
          <button
            className="p-3 text-white"
            onClick={async () => {
              await keyringLock();
              navigate("/unlock");
            }}
          >
            <i className="hn hn-lock-alt text-[20px]" />
          </button>
        </div>
      </div>
      {!isMainnet && (
        <div className="-mx-3 bg-[#854D0E4D] px-4 py-1.5 text-center text-[#EAB308]">
          You’re in testnet mode
        </div>
      )}

      {/* Content */}
      <div className="flex flex-col items-center gap-3">
        {/* Balance Display */}
        <div className="flex flex-col items-center py-3">
          <button onClick={() => toggleBalance()} className="mx-auto p-4">
            <i
              className={twMerge(
                "hn text-[16px]",
                showBalance ? "hn-eye-cross" : "hn-eye",
              )}
            ></i>
          </button>

          {totalBalanceFormatted === undefined ? (
            <div className="mx-auto h-[54px] w-[160px] animate-pulse self-center rounded-xl bg-daintree-700" />
          ) : (
            <div className="relative flex items-center">
              <span className="text-center text-4xl font-semibold text-white">
                {showBalance
                  ? totalBalanceFormatted
                  : `${symbolForCurrencyCode(currencyCode)}*****`}
              </span>
            </div>
          )}

          {/* Performance */}
          <div className="min-h-[44px] pt-2">
            {showBalance && (
              <HoverTooltip
                id="performance"
                text={
                  "Your wallet’s total value change over the past 24 hours."
                }
                tooltipWidth="292px"
                place="bottom"
                style={{
                  fontSize: "14px",
                  lineBreak: "normal",
                  textAlign: "center",
                }}
              >
                <div
                  className={twMerge(
                    "flex items-center gap-2 text-sm font-medium",
                    performance < 0 ? "text-[#EF4444]" : "text-[#14B8A6]",
                  )}
                >
                  <span className="min-w-[60px] text-right">
                    {performance >= 0 ? "+" : "-"}{" "}
                    {formatCurrency(Math.abs(performance), currencyCode)}{" "}
                  </span>
                  <span
                    className={twMerge(
                      "min-w-[60px] rounded-md px-1.5 py-1",
                      performance < 0
                        ? "bg-[#991B1B4D]/30"
                        : "bg-[#115E594D]/30",
                    )}
                  >
                    {performance >= 0 && "+"}
                    {performanceInPercent}%
                  </span>
                </div>
              </HoverTooltip>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex w-full justify-center gap-10 text-sm text-daintree-400">
          <button
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => navigate("/asset-select")}
            disabled={!isConnected}
          >
            <div
              className={twMerge(
                "flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10",
                !isConnected && "animate-pulse",
              )}
            >
              <i
                className={twMerge(
                  "hn hn-arrow-up text-[20px]",
                  isConnected ? "text-white" : "text-daintree-600",
                )}
              ></i>
            </div>
            <span className="text-daintree-400">Send</span>
          </button>

          <button
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => navigate("/receive/select-address")}
            disabled={!isConnected}
          >
            <div
              className={twMerge(
                "flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10",
                !isConnected && "animate-pulse",
              )}
            >
              <i
                className={twMerge(
                  "hn hn-arrow-down text-[20px]",
                  isConnected ? "text-white" : "text-daintree-600",
                )}
              ></i>
            </div>
            <span className="text-daintree-400">Receive</span>
          </button>

          {/* Deploy */}
          {isLedger && (
            <Tooltip
              id="deploy"
              style={{
                backgroundColor: "#203C49",
                fontSize: "12px",
                fontWeight: 600,
                padding: "8px",
              }}
              isOpen={deployHovered}
              place="bottom"
            />
          )}
          <div
            className={twMerge(
              "flex cursor-pointer flex-col items-center gap-2",
              isLedger && "opacity-40",
            )}
            onClick={() => {
              if (isLedger) {
                return;
              }

              const url = new URL(browser.runtime.getURL("/popup.html"));
              url.hash = `/deploy-token`;

              browser.tabs.create({ url: url.toString() });
            }}
            onMouseEnter={() => {
              if (isLedger) setDeployHovered(true);
            }}
            onMouseLeave={() => {
              if (isLedger) setDeployHovered(false);
            }}
            data-tooltip-id="deploy"
            data-tooltip-content="Ledger doesn’t support deploy function currently."
          >
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
              <i className="hn hn-pencil text-[20px] text-white"></i>
            </div>
            <span className="text-daintree-400">Deploy</span>
          </div>

          {/* Mint */}
          {isLedger && (
            <Tooltip
              id="mint"
              style={{
                backgroundColor: "#203C49",
                fontSize: "12px",
                fontWeight: 600,
                padding: "8px",
              }}
              isOpen={mintHovered}
              place="bottom-start"
            />
          )}
          <div
            className={twMerge(
              "flex cursor-pointer flex-col items-center gap-2",
              isLedger && "opacity-40",
            )}
            onClick={() => {
              if (isLedger) {
                return;
              }

              const url = new URL(browser.runtime.getURL("/popup.html"));
              url.hash = `/mint-token`;

              browser.tabs.create({ url: url.toString() });
            }}
            onMouseEnter={() => {
              if (isLedger) setMintHovered(true);
            }}
            onMouseLeave={() => {
              if (isLedger) setMintHovered(false);
            }}
            data-tooltip-id="mint"
            data-tooltip-content="Ledger doesn’t support mint function currently."
          >
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
              <img alt="castle" className="h-[24px] w-[24px]" src={gavelIcon} />
            </div>
            <span className="text-daintree-400">Mint</span>
          </div>
        </div>

        {/* Share Card */}
        <div className="flex w-full items-center gap-3 rounded-xl bg-daintree-800 px-4 py-2.5">
          <div className="flex size-[46px] flex-none items-center justify-center gap-2 rounded-lg border border-transparent bg-white/10">
            <i className="hn hn-crown text-[20px] text-daintree-400" />
          </div>
          <div className="flex flex-col gap-1 text-[#F4F3F2]">
            <span className="text-sm font-semibold">
              👑 Welcome to your Kastle! 🏰
            </span>
            <span className="text-xs">
              {
                "Thanks for joining our soft launch 🚀, we'd love to hear about your thoughts 💭: "
              }
              <a
                href="https://t.me/kastlewallet"
                className="text-icy-blue-400 underline"
                target="_blank"
                rel="noreferrer"
              >
                here
              </a>
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex w-full flex-col gap-2 text-lg">
          <div className="flex items-center font-semibold">
            {tabs.map((tab, index) => (
              <span
                key={index}
                className={twMerge(
                  "cursor-pointer border-b-2 px-3 py-2",
                  activeTab === tab
                    ? "border-cyan-500 text-cyan-500"
                    : "border-[#203C49]",
                )}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </span>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === "Assets" && <Assets />}
          {activeTab === "NFT" && <KRC721List />}
          {activeTab === "KNS" && <KNS />}
          {activeTab === "Text" && <KNSText />}
        </div>
      </div>
    </div>
  );
}
