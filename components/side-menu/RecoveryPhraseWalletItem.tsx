import { useNavigate } from "react-router-dom";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import AccountItem from "./AccountItem";
import WalletHeader from "./WalletHeader";
import useAccountManager from "@/hooks/wallet/useAccountManager";

interface RecoveryPhraseWalletItemProps {
  wallet: WalletInfo;
  onClose: () => void;
}

export const RecoveryPhraseWalletItem = ({
  wallet,
  onClose,
}: RecoveryPhraseWalletItemProps) => {
  const navigate = useNavigate();
  const { addAccount } = useAccountManager();

  const menuItems = [
    {
      label: "Back up recovery phrase",
      onClick: async () => {
        navigate(`/backup-unlock?redirect=/show-recovery-phrase/${wallet.id}`);
      },
    },
    {
      label: "Manage accounts",
      onClick: () => {
        const url = new URL(browser.runtime.getURL("/popup.html"));
        url.hash = `/manage-accounts/recovery-phrase/${wallet.id}/manage`;
        browser.tabs.create({ url: url.toString() });
      },
    },
    {
      label: "Remove this wallet",
      onClick: () => navigate(`/remove-wallet/${wallet.id}`),
      isAlert: true,
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
