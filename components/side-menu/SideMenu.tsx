import { RecoveryPhraseWalletItem } from "@/components/side-menu/RecoveryPhraseWalletItem.tsx";
import { useNavigate } from "react-router-dom";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { PrivateKeyWalletItem } from "@/components/side-menu/PrivateKeyWalletItem.tsx";
import { LedgerWalletItem } from "@/components/side-menu/LedgerWalletItem";
import useWalletManager from "@/hooks/wallet/useWalletManager";

type SideMenuProps = { isOpen: boolean; onClose: () => void };

export const SideMenu = ({ isOpen, onClose }: SideMenuProps) => {
  useResetPreline([isOpen]);
  const navigate = useNavigate();
  const { walletSettings } = useWalletManager();

  const wallets = walletSettings?.wallets;

  const recoveryPhraseWallets = wallets?.filter(
    (wallet) => wallet.type === "mnemonic",
  );

  const privateKeyWallets = wallets?.filter(
    (wallet) => wallet.type === "privateKey",
  );

  const ledgerWallets = wallets?.filter((wallet) => wallet.type === "ledger");

  return (
    <>
      {/* Side Menu */}
      <div
        className={`no-scrollbar fixed left-0 top-0 z-50 h-full min-h-0 w-full transform overflow-y-scroll bg-icy-blue-950 p-4 transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-[600px]"
        }`}
      >
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between px-2">
            <button
              className="rounded-lg p-3 text-white hover:bg-gray-800"
              onClick={() => onClose()}
            >
              <i className="hn hn-times flex items-center justify-center text-base leading-none" />
            </button>
            <span className="text-xl font-bold">Wallets</span>
            <button
              className="h-[38px] w-[38px] rounded-full bg-icy-blue-400 hover:bg-icy-blue-600"
              onClick={() => {
                navigate("/add-wallet");
              }}
            >
              <i className="hn hn-plus text-[16px]"></i>
            </button>
          </div>

          {/* Wallet list */}
          <div className="flex flex-col items-stretch gap-3">
            {recoveryPhraseWallets?.map((wallet) => (
              <RecoveryPhraseWalletItem
                key={wallet.id}
                wallet={wallet}
                onClose={onClose}
              />
            ))}
          </div>
          <div className="flex flex-col items-stretch gap-3">
            {privateKeyWallets?.map((wallet) => (
              <PrivateKeyWalletItem
                key={wallet.id}
                wallet={wallet}
                onClose={onClose}
              />
            ))}
          </div>

          {/* Ledger */}
          <div className="flex flex-col items-stretch gap-3">
            {ledgerWallets?.map((wallet) => (
              <LedgerWalletItem
                key={wallet.id}
                wallet={wallet}
                onClose={onClose}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
