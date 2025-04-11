import { twMerge } from "tailwind-merge";
import { formatCurrency, walletAddressEllipsis } from "@/lib/utils.ts";
import { Link } from "react-router-dom";
import React from "react";
import { Account } from "@/contexts/WalletManagerContext.tsx";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";

interface RecoveryPhraseAccountItemProps {
  account: Account;
  walletId: string;
  onClose: () => void;
}

export default function RecoveryPhraseAccountItem({
  account,
  walletId,
  onClose,
}: RecoveryPhraseAccountItemProps) {
  const [settings] = useSettings();
  const kapsaPrice = useKaspaPrice();
  const { selectAccount, walletSettings } = useWalletManager();
  const isSelectedWalletId = walletSettings?.selectedWalletId === walletId;
  const selectedAccountIndex = walletSettings?.selectedAccountIndex;

  const fiatBalance =
    parseFloat(account.balance ?? "0") * kapsaPrice.kaspaPrice;
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);

  return (
    <div
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
            selectAccount(walletId, account.index);
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
                    formatCurrency(totalBalanceCurrency, currencyCode)}
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
              to={`/rename-account/${walletId}/${account.index}`}
              className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
            >
              Rename this account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
