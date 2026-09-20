import { RecoveryPhraseWalletItem } from "@/components/side-menu/RecoveryPhraseWalletItem.tsx";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useResetPreline from "@/hooks/useResetPreline.ts";
import { PrivateKeyWalletItem } from "@/components/side-menu/PrivateKeyWalletItem.tsx";
import { LedgerWalletItem } from "@/components/side-menu/LedgerWalletItem";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useAccountManager from "@/hooks/wallet/useAccountManager";
import {
  listKaspaWallets,
  runExclusiveWalletSelection,
} from "@/lib/wallet-switcher-selection";
import { useSettings } from "@/hooks/useSettings";
import useStorageState from "@/hooks/useStorageState";
import { isZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";
import { getZKasSwitchAccounts } from "@/lib/zkas/popup-client";
import type { ZKasSwitchAccount } from "@/lib/zkas/selection";
import { ZKasWalletSection } from "./ZKasWalletSection";

type SideMenuProps = { isOpen: boolean; onClose: () => void };

export const SideMenu = ({ isOpen, onClose }: SideMenuProps) => {
  useResetPreline([isOpen]);
  const navigate = useNavigate();
  const { walletSettings } = useWalletManager();
  const [settings] = useSettings();
  const [experimentalEnabled] = useStorageState<boolean | null>(
    ZKAS_EXPERIMENTAL_KEY,
    null,
  );
  const zkasActive = isZKasActive(settings, experimentalEnabled);
  const [zkasAccounts, setZKasAccounts] = useState<ZKasSwitchAccount[]>([]);
  const [zkasLoading, setZKasLoading] = useState(false);
  const { selectAccount } = useAccountManager();
  const selectionLock = useRef({ busy: false });
  const [switching, setSwitching] = useState(false);
  const [selectionError, setSelectionError] = useState("");

  const wallets = walletSettings?.wallets;

  useEffect(() => {
    if (!isOpen || !zkasActive) return;
    let active = true;
    setZKasLoading(true);
    void getZKasSwitchAccounts()
      .then((accounts) => {
        if (active) {
          setZKasAccounts(accounts);
          setSelectionError("");
        }
      })
      .catch((cause) => {
        if (active)
          setSelectionError(
            cause instanceof Error
              ? cause.message
              : "Unable to load ZKas wallets",
          );
      })
      .finally(() => {
        if (active) setZKasLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, zkasActive, walletSettings?.wallets]);

  const kaspaWallets = listKaspaWallets(wallets ?? []);
  const recoveryPhraseWallets = kaspaWallets.filter(
    (wallet) => wallet.type === "mnemonic",
  );

  const privateKeyWallets = kaspaWallets.filter(
    (wallet) => wallet.type === "privateKey",
  );

  const ledgerWallets = kaspaWallets.filter(
    (wallet) => wallet.type === "ledger",
  );

  const chooseAccount = async (walletId: string, accountIndex: number) => {
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
          const latestSettings =
            await storage.getItem<typeof settings>("local:settings");
          const latestEnabled = await storage.getItem<boolean>(
            ZKAS_EXPERIMENTAL_KEY,
          );
          if (zkasActive !== isZKasActive(latestSettings, latestEnabled)) {
            throw new Error("Network changed. Reopen the wallet switcher.");
          }
          if (zkasActive) {
            const latestAccounts = await getZKasSwitchAccounts();
            if (
              !latestAccounts.some(
                (item) =>
                  item.walletId === walletId &&
                  item.accountIndex === accountIndex,
              )
            ) {
              throw new Error("This wallet is unavailable on ZKas Mainnet");
            }
          } else if (wallet.type === "zkasSeed") {
            throw new Error("This wallet is unavailable on Kaspa");
          }
          setSelectionError("");
          await selectAccount(walletId, accountIndex);
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

  const walletList = (
    <section aria-label="Wallets" className="flex flex-col gap-3">
      <div className="flex flex-col items-stretch gap-3">
        {recoveryPhraseWallets?.map((wallet) => (
          <RecoveryPhraseWalletItem
            key={wallet.id}
            wallet={wallet}
            onClose={onClose}
            onSelectAccount={chooseAccount}
          />
        ))}
      </div>
      <div className="flex flex-col items-stretch gap-3">
        {privateKeyWallets?.map((wallet) => (
          <PrivateKeyWalletItem
            key={wallet.id}
            wallet={wallet}
            onClose={onClose}
            onSelectAccount={chooseAccount}
          />
        ))}
      </div>
      <div className="flex flex-col items-stretch gap-3">
        {ledgerWallets?.map((wallet) => (
          <LedgerWalletItem
            key={wallet.id}
            wallet={wallet}
            onClose={onClose}
            onSelectAccount={chooseAccount}
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
          isOpen ? "translate-x-0" : "-translate-x-full"
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
            {zkasActive ? (
              zkasLoading ? (
                <p className="px-2 text-sm text-daintree-200">
                  Loading ZKas wallets…
                </p>
              ) : (
                walletSettings && (
                  <ZKasWalletSection
                    wallets={wallets ?? []}
                    accounts={zkasAccounts}
                    walletSettings={walletSettings}
                    onSelectAccount={chooseAccount}
                  />
                )
              )
            ) : (
              walletList
            )}
          </fieldset>
        </div>
      </div>
    </>
  );
};
