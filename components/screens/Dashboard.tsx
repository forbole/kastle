import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SideMenu } from "@/components/side-menu/SideMenu.tsx";
import { explorerAddressLinks } from "@/components/screens/Settings.tsx";
import kasIcon from "@/assets/images/kas-icon.svg";
import gavelIcon from "@/assets/images/gavel.svg";
import { formatToken, formatTokenPrice, formatUSD } from "@/lib/utils.ts";
import ClipboardCopy from "@/components/ClipboardCopy";
import { twMerge } from "tailwind-merge";
import useBackupWarning from "@/hooks/useBackupWarning.ts";
import useKeyring from "@/hooks/useKeyring.ts";
import useWalletManager from "@/hooks/useWalletManager.ts";
import TokenListItem from "@/components/dashboard/TokenListItem.tsx";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useTokenListByAddress } from "@/hooks/useTokenListByAddress.ts";
import { applyDecimal } from "@/lib/krc20.ts";

export default function Dashboard() {
  const { keyringLock } = useKeyring();
  const navigate = useNavigate();
  const { networkId } = useRpcClientStateful();
  const [settings, setSettings] = useSettings();
  const kapsaPrice = useKaspaPrice();
  const { showWarning } = useBackupWarning();
  const { account, wallet } = useWalletManager();
  const [dismissWarning, setDismissWarning] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const address = account?.address;
  const balance = account?.balance;
  const showBalance = !settings?.hideBalances;

  const { data: tokenListResponse } = useTokenListByAddress(address, 5000);
  const tokenListItems = tokenListResponse?.result
    ? tokenListResponse.result
    : [];
  const tokens = tokenListItems.sort((a, b) => {
    const { toFloat: aToFloat } = applyDecimal(a.dec);
    const { toFloat: bToFloat } = applyDecimal(b.dec);

    return (
      bToFloat(parseInt(b.balance, 10)) - aToFloat(parseInt(a.balance, 10))
    );
  });

  const toggleBalance = () =>
    setSettings((prevSettings) => ({
      ...prevSettings,
      hideBalances: !prevSettings.hideBalances,
    }));

  const network = networkId ?? NetworkType.Mainnet;
  const explorerAddressLink = explorerAddressLinks[network];
  const isMainnet = network === NetworkType.Mainnet;

  const totalBalance = balance
    ? formatUSD(parseFloat(balance) * kapsaPrice.kaspaPrice)
    : undefined;

  const isAssetListLoading = balance === null;

  return (
    <div className="relative flex h-full w-full flex-col px-3">
      {/* Warning popup */}
      {showWarning && !dismissWarning && (
        <div
          className="absolute bottom-0 left-0 m-3 flex flex-col gap-2 rounded-xl border border-[#7F1D1D] bg-[#381825] p-4 text-base"
          role="alert"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-daintree-200">
              Backup your Kastle recovery phrase
            </span>
            <button type="button" onClick={() => setDismissWarning(true)}>
              <i className="hn hn-times text-[16px]"></i>
            </button>
          </div>

          <span className="text-sm text-daintree-400">
            ✋👑 Hold on, Your Majesty! Please back up your recovery phrase 📜.
            It’s the 🗝️ key to accessing your Kastle if you lose your password
            or need to reinstall your browser or extension 🌐.
          </span>
          <button
            onClick={() =>
              navigate(
                `/backup-unlock?redirect=/show-recovery-phrase/${wallet?.id}`,
              )
            }
            type="button"
            className="inline-flex items-center gap-x-2 self-start rounded-lg border border-transparent bg-red-800/30 px-4 py-3 text-sm font-medium text-red-500 hover:bg-red-200 hover:bg-red-800/20 focus:bg-red-200 focus:bg-red-800/20 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
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
        <div className="flex cursor-pointer rounded-lg font-semibold">
          <div
            className="flex flex-1 items-center space-x-2 rounded-l-lg border border-gray-500 p-2 hover:border-white"
            onClick={() => setIsMenuOpen(true)}
          >
            <span className="flex size-6 items-center justify-center rounded-lg bg-[#9CA3AF] text-white">
              {account?.name?.[0]}
              {account?.name?.[account?.name?.length - 1]}
            </span>
            <span className="text-base text-white">{account?.name}</span>
            <i className="hn hn-angle-right text-[16px] text-white" />
          </div>
          <ClipboardCopy
            className="flex cursor-pointer items-stretch rounded-r-lg border border-gray-500 hover:border-white"
            textToCopy={address}
          />
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
        <div className="py-3">
          {totalBalance === undefined ? (
            <div className="h-[54px] w-[160px] animate-pulse self-center rounded-xl bg-daintree-700" />
          ) : (
            <div className="relative flex items-center">
              <span className="text-center text-4xl font-semibold text-white">
                {showBalance ? totalBalance : "$*****"}
              </span>
              <button onClick={() => toggleBalance()} className="p-4">
                <i
                  className={twMerge(
                    "hn text-[16px]",
                    showBalance ? "hn-eye-cross" : "hn-eye",
                  )}
                ></i>
              </button>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex w-full justify-center gap-10 text-sm text-daintree-400">
          <div
            className="flex cursor-pointer flex-col items-center gap-2"
            onClick={() => navigate("/send")}
          >
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
              <i className="hn hn-arrow-up text-[20px] text-white"></i>
            </div>
            <span className="text-daintree-400">Send</span>
          </div>

          <div
            className="flex cursor-pointer flex-col items-center gap-2"
            onClick={() => navigate("/receive")}
          >
            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
              <i className="hn hn-arrow-down text-[20px] text-white"></i>
            </div>
            <span className="text-daintree-400">Receive</span>
          </div>

          {wallet?.type !== "ledger" ? (
            <>
              <div
                className="flex cursor-pointer flex-col items-center gap-2"
                onClick={() => {
                  const url = new URL(browser.runtime.getURL("/popup.html"));
                  url.hash = `/deploy-token`;

                  browser.tabs.create({ url: url.toString() });
                }}
              >
                <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
                  <i className="hn hn-pencil text-[20px] text-white"></i>
                </div>
                <span className="text-daintree-400">Deploy</span>
              </div>
              <div
                className="flex cursor-pointer flex-col items-center gap-2"
                onClick={() => {
                  const url = new URL(browser.runtime.getURL("/popup.html"));
                  url.hash = `/mint-token`;

                  browser.tabs.create({ url: url.toString() });
                }}
              >
                <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
                  <img
                    alt="castle"
                    className="h-[24px] w-[24px]"
                    src={gavelIcon}
                  />
                </div>
                <span className="text-daintree-400">Mint</span>
              </div>
            </>
          ) : (
            <a
              className="flex cursor-pointer flex-col items-center gap-2"
              href={`${explorerAddressLink}${address}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-white/10">
                <i className="hn hn-external-link text-[20px] text-white"></i>
              </div>
              <span className="text-daintree-400">Explorer</span>
            </a>
          )}
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

        <div className="flex w-full flex-col gap-2">
          <span className="py-2 text-lg font-semibold text-white">Assets</span>

          {/* Assets list */}
          {isAssetListLoading ? (
            <div className="flex animate-pulse items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
              <span className="block size-12 rounded-full bg-daintree-700"></span>
              <div className="h-[44px] flex-grow self-center rounded-xl bg-daintree-700" />
            </div>
          ) : (
            <div className="mb-4 flex flex-col items-stretch gap-2">
              {/*KAS*/}
              <div
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
                onClick={() => navigate("/kas-asset")}
              >
                <img alt="castle" className="h-[40px] w-[40px]" src={kasIcon} />
                <div className="flex flex-grow flex-col gap-1">
                  <div className="flex items-center justify-between text-base text-white">
                    <span>KAS</span>
                    <span>
                      {showBalance
                        ? formatToken(parseFloat(balance ?? "0"))
                        : "*****"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-daintree-400">
                    <span>{formatTokenPrice(kapsaPrice.kaspaPrice)}</span>
                    <span>
                      ≈{" "}
                      {showBalance
                        ? formatUSD(
                            parseFloat(balance ?? "0") * kapsaPrice.kaspaPrice,
                          )
                        : "$*****"}{" "}
                      USD
                    </span>
                  </div>
                </div>
              </div>

              {/*KRC20 tokens*/}
              {tokens.map((token) => (
                <TokenListItem key={token.tick} token={token} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
