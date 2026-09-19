import { RecoveryPhraseWalletItem } from "@/components/side-menu/RecoveryPhraseWalletItem.tsx";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { PrivateKeyWalletItem } from "@/components/side-menu/PrivateKeyWalletItem.tsx";
import { LedgerWalletItem } from "@/components/side-menu/LedgerWalletItem";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useAccountManager from "@/hooks/wallet/useAccountManager";
import useSwitchNetwork from "@/hooks/useSwitchNetwork";
import { runExclusiveWalletSelection } from "@/lib/wallet-switcher-selection";
import { useSettings } from "@/hooks/useSettings";
import useStorageState from "@/hooks/useStorageState";
import {
  getVisibleWalletNetworks,
  isZKasActive,
  ZKAS_EXPERIMENTAL_KEY,
  ZKAS_MAINNET,
} from "@/lib/wallet-network";
import { ZKasWalletSection } from "./ZKasWalletSection";

type SideMenuProps = { isOpen: boolean; onClose: () => void };

export const SideMenu = ({ isOpen, onClose }: SideMenuProps) => {
  useResetPreline([isOpen]);
  const navigate = useNavigate();
  const { walletSettings } = useWalletManager();
  const { selectAccount } = useAccountManager();
  const { switchKaspaNetwork, switchZKasNetwork } = useSwitchNetwork();
  const selectionLock = useRef({ busy: false });
  const [switching, setSwitching] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [settings] = useSettings();
  const [zkasEnabled, , isZKasGateLoading] = useStorageState<boolean | null>(
    ZKAS_EXPERIMENTAL_KEY,
    null,
  );
  const showZKas =
    !isZKasGateLoading &&
    !!settings &&
    getVisibleWalletNetworks(settings, zkasEnabled).includes(ZKAS_MAINNET);
  const zkasFirst = showZKas && isZKasActive(settings, zkasEnabled);

  const wallets = walletSettings?.wallets;

  const recoveryPhraseWallets = wallets?.filter(
    (wallet) => wallet.type === "mnemonic",
  );

  const privateKeyWallets = wallets?.filter(
    (wallet) => wallet.type === "privateKey",
  );

  const ledgerWallets = wallets?.filter((wallet) => wallet.type === "ledger");

  const chooseAccount = async (
    chain: "kaspa" | "zkas",
    walletId: string,
    accountIndex: number,
  ) => {
    try {
      await runExclusiveWalletSelection(
        selectionLock.current,
        async () => {
          const wallet = walletSettings?.wallets.find(
            (item) => item.id === walletId,
          );
          if (!wallet?.accounts.some((item) => item.index === accountIndex)) {
            throw new Error(
              "This wallet changed. Close and reopen the switcher.",
            );
          }
          setSelectionError("");
          await selectAccount(walletId, accountIndex);
          if (chain === "zkas") await switchZKasNetwork();
          else if (settings?.activeChain === "zkas")
            await switchKaspaNetwork(settings.networkId);
          onClose();
          navigate("/dashboard");
        },
        setSwitching,
      );
    } catch (cause) {
      setSelectionError(
        cause instanceof Error ? cause.message : "Unable to switch wallets",
      );
    }
  };

  const chooseKaspaAccount = (walletId: string, accountIndex: number) =>
    chooseAccount("kaspa", walletId, accountIndex);
  const chooseZKasAccount = (walletId: string, accountIndex: number) =>
    chooseAccount("zkas", walletId, accountIndex);

  const kaspaWallets = (
    <section aria-label="Kaspa wallets" className="flex flex-col gap-3">
      {showZKas && (
        <h2 className="px-2 text-sm font-semibold text-daintree-400">
          Kaspa wallets
        </h2>
      )}
      <div className="flex flex-col items-stretch gap-3">
        {recoveryPhraseWallets?.map((wallet) => (
          <RecoveryPhraseWalletItem
            key={wallet.id}
            wallet={wallet}
            onClose={onClose}
            onSelectAccount={chooseKaspaAccount}
          />
        ))}
      </div>
      <div className="flex flex-col items-stretch gap-3">
        {privateKeyWallets?.map((wallet) => (
          <PrivateKeyWalletItem
            key={wallet.id}
            wallet={wallet}
            onClose={onClose}
            onSelectAccount={chooseKaspaAccount}
          />
        ))}
      </div>
      <div className="flex flex-col items-stretch gap-3">
        {ledgerWallets?.map((wallet) => (
          <LedgerWalletItem
            key={wallet.id}
            wallet={wallet}
            onClose={onClose}
            onSelectAccount={chooseKaspaAccount}
          />
        ))}
      </div>
    </section>
  );

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
              disabled={switching}
              onClick={() => {
                navigate("/add-wallet");
              }}
            >
              <i className="hn hn-plus text-[16px]"></i>
            </button>
          </div>

          {selectionError && (
            <p role="alert" className="px-2 text-xs text-red-400">
              {selectionError}
            </p>
          )}
          <fieldset
            disabled={switching}
            className="flex min-w-0 flex-col gap-3 disabled:opacity-50"
          >
            {zkasFirst && (
              <ZKasWalletSection
                isOpen={isOpen}
                onSelectAccount={chooseZKasAccount}
              />
            )}
            {kaspaWallets}
            {showZKas && !zkasFirst && (
              <ZKasWalletSection
                isOpen={isOpen}
                onSelectAccount={chooseZKasAccount}
              />
            )}
          </fieldset>
        </div>
      </div>
    </>
  );
};
