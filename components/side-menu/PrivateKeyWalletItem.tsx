import { useNavigate } from "react-router-dom";
import { WalletInfo } from "@/contexts/WalletManagerContext.tsx";
import AccountItem from "./AccountItem";
import WalletHeader from "./WalletHeader";

interface PrivateKeyWalletItemProps {
  wallet: WalletInfo;
  onClose: () => void;
}

export const PrivateKeyWalletItem = ({
  wallet,
  onClose,
}: PrivateKeyWalletItemProps) => {
  const navigate = useNavigate();

  return (
    <div className="hs-accordion-group">
      <div className="hs-accordion active flex flex-col items-stretch gap-2">
        <WalletHeader wallet={wallet} />

        {/* Account item */}
        <div className="hs-accordion-content w-full overflow-hidden transition-[height] duration-300">
          <div className="flex flex-col items-stretch gap-3">
            {wallet.accounts.map((account) => (
              <AccountItem
                key={account.index}
                walletId={wallet.id}
                account={account}
                onClose={onClose}
              >
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/backup-unlock?redirect=/show-private-key/${wallet.id}/${account.index}`,
                    )
                  }
                  className="flex w-full items-center gap-x-3.5 rounded-lg px-3 py-2 text-sm text-daintree-200 hover:bg-daintree-700 focus:bg-daintree-700 focus:outline-none"
                >
                  Back up with private key
                </button>
              </AccountItem>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
