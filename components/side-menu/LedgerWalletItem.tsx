import React from "react";
import { useBoolean } from "usehooks-ts";
import { twMerge } from "tailwind-merge";
import { useNavigate } from "react-router-dom";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import AccountItem from "./AccountItem";
import WalletHeader from "./WalletHeader";

interface LedgerWalletItemProps {
  wallet: WalletInfo;
  onClose: () => void;
}

export const LedgerWalletItem = ({
  wallet,
  onClose,
}: LedgerWalletItemProps) => {
  const navigate = useNavigate();
  // This is a hack, preline could not handle `hs-accordion-active:` on nested tags
  const { value: collapsed, toggle } = useBoolean(false);

  const manageAccounts = () => {
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = `/manage-accounts/ledger/${wallet.id}/manage`;

    browser.tabs.create({ url: url.toString() });
  };

  const menuItems = [
    {
      label: "Manage accounts",
      onClick: manageAccounts,
    },
    {
      label: "Remove this wallet",
      onClick: () => navigate(`/remove-wallet/${wallet.id}`),
    },
  ];

  return (
    <div className="hs-accordion-group">
      <div className="hs-accordion active flex flex-col items-stretch gap-2">
        <WalletHeader wallet={wallet} items={menuItems} />

        {/* Account item */}
        <div className="hs-accordion-content w-full overflow-hidden transition-[height] duration-300">
          <div className="flex flex-col items-stretch gap-3">
            {wallet.accounts.map((account) => (
              <AccountItem
                key={account.index}
                account={account}
                walletId={wallet.id}
                onClose={onClose}
              />
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
