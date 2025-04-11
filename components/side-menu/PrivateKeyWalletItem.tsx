import React from "react";
import { useBoolean } from "usehooks-ts";
import { twMerge } from "tailwind-merge";
import { useNavigate } from "react-router-dom";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import PrivateKeyAccountItem from "@/components/side-menu/PrivateKeyAccountItem.tsx";

interface PrivateKeyWalletItemProps {
  wallet: WalletInfo;
  onClose: () => void;
}

export const PrivateKeyWalletItem = ({
  wallet,
  onClose,
}: PrivateKeyWalletItemProps) => {
  const navigate = useNavigate();
  // This is a hack, preline could not handle `hs-accordion-active:` on nested tags
  const { value: collapsed, toggle } = useBoolean(false);

  return (
    <div className="hs-accordion-group">
      <div className="hs-accordion active flex flex-col items-stretch gap-2">
        <div className="flex items-center justify-end">
          <span className="mr-auto px-2 text-sm font-semibold">
            {wallet.name}
          </span>
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
              <PrivateKeyAccountItem
                key={account.address}
                account={account}
                walletId={wallet.id}
                onClose={onClose}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
