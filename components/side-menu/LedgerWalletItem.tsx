import React from "react";
import { formatUSD, walletAddressEllipsis } from "@/lib/utils.ts";
import { useBoolean } from "usehooks-ts";
import { twMerge } from "tailwind-merge";
import { Link, useNavigate } from "react-router-dom";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";

interface LedgerWalletItemProps {
  wallet: WalletInfo;
  onClose: () => void;
}

export const LedgerWalletItem = ({
  wallet,
  onClose,
}: LedgerWalletItemProps) => {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const kapsaPrice = useKaspaPrice();
  // This is a hack, preline could not handle `hs-accordion-active:` on nested tags
  const { value: collapsed, toggle } = useBoolean(false);
  const { selectAccount, walletSettings } = useWalletManager();
  const isSelectedWalletId = walletSettings?.selectedWalletId === wallet.id;
  const selectedAccountIndex = walletSettings?.selectedAccountIndex;

  const manageAccounts = () => {
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/manage-accounts/ledger/${wallet.id}/manage`;

    browser.tabs.create({ url: url.toString() });
  };

  return (
    <div className="hs-accordion-group">
      <div className="hs-accordion active flex flex-col items-stretch gap-2">
        <div className="flex items-center justify-end">
          <div className="mr-auto flex items-center">
            <span className="mr-auto px-2 text-sm font-semibold">
              {wallet.name}
            </span>
          </div>
          <button
            type="button"
            className="hs-accordion-toggle h-[38px] w-[38px]"
            onClick={toggle}
          >
            <i
              className={twMerge(
                "hn text-[16px]",
                collapsed ? "hn-angle-down" : "hn-angle-up",
              )}
            ></i>
          </button>
          <div className="hs-dropdown relative">
            <button
              type="button"
              className="hs-dropdown-toggle h-[38px] w-[38px]"
            >
              <i className="hn hn-ellipses-vertical text-[16px]"></i>
            </button>
            <div
              className="hs-dropdown-menu duration z-10 mt-2 hidden divide-neutral-700 rounded-lg border border-daintree-700 bg-daintree-800 opacity-0 shadow-md transition-[opacity,margin] before:absolute before:-top-4 before:start-0 before:h-4 before:w-full after:absolute after:-bottom-4 after:start-0 after:h-4 after:w-full hs-dropdown-open:opacity-100"
              role="menu"
              aria-orientation="vertical"
              aria-labelledby="hs-dropdown-default"
            >
              <div className="space-y-0.5 p-1">
                <button
                  type="button"
                  onClick={() => manageAccounts()}
                  className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
                >
                  Manage accounts
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/remove-wallet/${wallet.id}`)}
                  className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
                >
                  Remove this wallet
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Account item */}
        <div className="hs-accordion-content w-full overflow-hidden transition-[height] duration-300">
          <div className="flex flex-col items-stretch gap-3">
            {wallet.accounts.map((account) => (
              <div
                key={account.index}
                className={twMerge(
                  "flex w-full",
                  isSelectedWalletId &&
                    account.index === selectedAccountIndex &&
                    "rounded-xl border-2 border-icy-blue-400 hover:border-transparent",
                )}
              >
                <div
                  key={account.index}
                  className="flex flex-1 items-center justify-stretch rounded-l-xl border border-daintree-700 bg-white/5 hover:border-white"
                >
                  <button
                    className="flex flex-1 items-center justify-stretch gap-2 px-2 py-3"
                    onClick={async () => {
                      selectAccount(wallet.id, account.index);
                      onClose();
                    }}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-white">
                      {account.name[0]}
                    </span>
                    <div className="flex flex-grow flex-col">
                      <div className="flex items-center justify-end gap-2 text-sm font-semibold">
                        <span className="mr-auto">{account.name}</span>
                        <span>
                          {settings?.hideBalances
                            ? "*****"
                            : account.balance &&
                              formatUSD(
                                parseFloat(account.balance) *
                                  kapsaPrice.kaspaPrice,
                              )}
                        </span>
                      </div>
                      <span className="text-left text-xs text-daintree-400">
                        {walletAddressEllipsis(account.address)}
                      </span>
                    </div>
                  </button>
                </div>

                <div className="hs-dropdown border-l-0.5 relative flex items-stretch justify-stretch self-stretch rounded-r-lg border border-daintree-700 bg-white/5 hover:border-white">
                  <button
                    type="button"
                    className="hs-dropdown-toggle flex items-center justify-center px-1.5"
                  >
                    <i className="hn hn-ellipses-vertical z-0 text-[16px]"></i>
                  </button>
                  <div
                    className="hs-dropdown-menu duration z-10 mt-2 hidden divide-neutral-700 rounded-lg border border-daintree-700 bg-daintree-800 opacity-0 shadow-md transition-[opacity,margin] before:absolute before:-top-4 before:start-0 before:h-4 before:w-full after:absolute after:-bottom-4 after:start-0 after:h-4 after:w-full hs-dropdown-open:opacity-100"
                    role="menu"
                    aria-orientation="vertical"
                    aria-labelledby="hs-dropdown-default"
                  >
                    <div className="space-y-0.5 p-1">
                      <Link
                        to={`/rename-account/${wallet.id}/${account.index}`}
                        className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
                      >
                        Rename this account
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Add account */}
            <button
              className="flex items-center justify-stretch gap-2 rounded-xl border border-daintree-700 bg-white/5 p-3 hover:border-white"
              onClick={() => manageAccounts()}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-white">
                <i className="hn hn-plus text-[16px]"></i>
              </span>
              <span className="flex flex-grow items-center text-left text-daintree-400">
                Create new account
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
