import { twMerge } from "tailwind-merge";
import { formatCurrency, textEllipsis } from "@/lib/utils.ts";
import { Link } from "react-router-dom";
import React from "react";
import { Account } from "@/contexts/WalletManagerContext.tsx";
import useTotalBalanceByAccount from "@/hooks/kasplex/useTotalBalanceByAccount";
import useAccountManager from "@/hooks/wallet/useAccountManager";
import useWalletManager from "@/hooks/wallet/useWalletManager";

type AccountItemProps = {
  walletId: string;
  account: Account;
  onClose: () => void;
  children?: React.ReactNode;
};

export default function AccountItem({
  walletId,
  account,
  onClose,
  children,
}: AccountItemProps) {
  const [settings] = useSettings();
  const { walletSettings } = useWalletManager();
  const { selectAccount } = useAccountManager();
  const isSelectedWalletId = walletSettings?.selectedWalletId === walletId;
  const selectedAccountIndex = walletSettings?.selectedAccountIndex;
  const totalBalance = useTotalBalanceByAccount(
    account?.balance ? account : undefined,
  );
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(totalBalance);

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
        className="flex flex-grow items-center justify-stretch rounded-l-xl border border-daintree-700 bg-white/5 hover:border-white"
      >
        <button
          className="flex flex-grow items-center justify-stretch gap-2 px-2 py-3"
          onClick={async () => {
            selectAccount(walletId, account.index);
            onClose();
          }}
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-sm font-semibold text-white">
            {account.name.length > 1
              ? account.name[0] + account.name[account.name.length - 1]
              : account.name[0]}
          </span>
          <div className="flex flex-grow flex-col">
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="mr-auto font-semibold">{account.name}</span>
              <span>
                {settings?.hideBalances
                  ? "*****"
                  : account.balance &&
                    formatCurrency(totalBalanceCurrency, currencyCode)}
              </span>
            </div>
            <span className="text-left text-xs text-daintree-400">
              {textEllipsis(account.address)}
            </span>
          </div>
        </button>
      </div>

      <div className="hs-dropdown relative flex items-stretch justify-stretch self-stretch rounded-r-xl border border-daintree-700 bg-white/5 hover:border-white">
        <button
          type="button"
          className="hs-dropdown-toggle flex items-center justify-center px-1.5"
        >
          <i className="hn hn-ellipses-vertical z-0 text-[16px]"></i>
        </button>
        <div
          className="hs-dropdown-menu duration z-10 hidden divide-neutral-700 rounded-lg border border-daintree-700 bg-daintree-800 opacity-0 shadow-md transition-[opacity,margin] before:absolute before:-top-4 before:start-0 before:h-4 before:w-full after:absolute after:-bottom-4 after:start-0 after:h-4 after:w-full hs-dropdown-open:opacity-100"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="hs-dropdown-default"
        >
          <div className="space-y-0.5 p-1">
            <Link
              to={`/rename-account/${walletId}/${account.index}`}
              className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
            >
              Rename this Account
            </Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
