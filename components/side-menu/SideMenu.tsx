import React from "react";
import { RecoveryPhraseWalletItem } from "@/components/side-menu/RecoveryPhraseWalletItem.tsx";
import { useNavigate } from "react-router-dom";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { PrivateKeyWalletItem } from "@/components/side-menu/PrivateKeyWalletItem.tsx";
import { LedgerWalletItem } from "@/components/side-menu/LedgerWalletItem";

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
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Side Menu */}
      <div
        className={`no-scrollbar fixed left-0 top-0 z-50 m-1 h-[592px] w-[324px] transform overflow-y-scroll rounded-2xl border border-daintree-700 bg-daintree-800 px-2.5 py-4 transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-[330px]"
        }`}
      >
        <div className="flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-stretch justify-between px-2">
            <span className="text-xl font-bold">Wallets</span>
            <button
              className="h-[38px] w-[38px] rounded-full bg-icy-blue-400"
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
