import React from "react";
import { useBoolean } from "usehooks-ts";
import { twMerge } from "tailwind-merge";
import { useNavigate } from "react-router-dom";
import { Tooltip } from "react-tooltip";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import AccountItem from "./AccountItem";

interface RecoveryPhraseWalletItemProps {
  wallet: WalletInfo;
  onClose: () => void;
}

export const RecoveryPhraseWalletItem = ({
  wallet,
  onClose,
}: RecoveryPhraseWalletItemProps) => {
  const navigate = useNavigate();
  // This is a hack, preline could not handle `hs-accordion-active:` on nested tags
  const { value: collapsed, toggle } = useBoolean(false);
  const { addAccount } = useWalletManager();

  return (
    <div className="hs-accordion-group">
      <div className="hs-accordion active flex flex-col items-stretch gap-2">
        <div className="flex items-center justify-end">
          <div className="mr-auto flex items-center">
            <span className="mr-auto px-2 text-sm font-semibold">
              {wallet.name}
            </span>
            {!wallet.backed && (
              <a
                data-tooltip-id="backup-wallet"
                data-tooltip-content="Please back up your recovery phrase 📜."
              >
                <Tooltip
                  data-tooltip-id="backup-wallet"
                  id="backup-wallet"
                  offset={0}
                  style={{
                    backgroundColor: "#374151",
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "2px 8px",
                  }}
                />
                <i className="hn hn-exclamation-triangle-solid text-[#EAB308]"></i>
              </a>
            )}
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
                  onClick={async () => {
                    navigate(
                      `/backup-unlock?redirect=/show-recovery-phrase/${wallet.id}`,
                    );
                  }}
                  className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
                >
                  Back up recovery phrase
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = new URL(browser.runtime.getURL("/popup.html"));
                    url.hash = `/manage-accounts/recovery-phrase/${wallet.id}/manage`;

                    browser.tabs.create({ url: url.toString() });
                  }}
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
              <AccountItem
                key={account.index}
                walletId={wallet.id}
                account={account}
                onClose={onClose}
              />
            ))}

            {/* Add account */}
            <button
              className="flex items-center justify-stretch gap-2 rounded-xl border border-daintree-700 bg-white/5 p-3 hover:border-white"
              onClick={() => addAccount(wallet.id, true)}
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
