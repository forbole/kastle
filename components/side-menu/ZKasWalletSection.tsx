import { useEffect, useState } from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { textEllipsis } from "@/lib/utils";
import { getZKasSwitchAccounts } from "@/lib/zkas/popup-client";
import type { ZKasSwitchAccount } from "@/lib/zkas/selection";
import { useSettings } from "@/hooks/useSettings";
import { isZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";
import useStorageState from "@/hooks/useStorageState";

type Props = {
  isOpen: boolean;
  onSelectAccount: (walletId: string, accountIndex: number) => Promise<void>;
};

export function ZKasWalletSection({ isOpen, onSelectAccount }: Props) {
  const { walletSettings } = useWalletManager();
  const [settings] = useSettings();
  const [enabled] = useStorageState<boolean | null>(
    ZKAS_EXPERIMENTAL_KEY,
    null,
  );
  const [accounts, setAccounts] = useState<ZKasSwitchAccount[]>();
  const [error, setError] = useState("");
  const isActive = isZKasActive(settings, enabled);

  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    setAccounts(undefined);
    setError("");
    void getZKasSwitchAccounts()
      .then((items) => {
        if (current) setAccounts(items);
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to list ZKas wallets",
          );
      });
    return () => {
      current = false;
    };
  }, [isOpen, walletSettings?.wallets]);

  const choose = (entry: ZKasSwitchAccount) => {
    const wallet = walletSettings?.wallets.find(
      (item) => item.id === entry.walletId,
    );
    if (!wallet?.accounts.some((item) => item.index === entry.accountIndex)) {
      setError("This wallet changed. Close and reopen the switcher.");
      return;
    }
    setError("");
    void onSelectAccount(entry.walletId, entry.accountIndex);
  };

  return (
    <section aria-label="ZKas wallets" className="flex flex-col gap-3">
      <h2 className="px-2 text-sm font-semibold text-icy-blue-400">
        ZKas wallets · Mainnet
      </h2>
      {accounts === undefined && !error && (
        <p role="status" className="px-2 text-xs text-daintree-400">
          Loading ZKas addresses…
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-red-400">
          {error}
        </p>
      )}
      {accounts?.length === 0 && (
        <p className="px-2 text-xs text-daintree-400">
          No ZKas accounts yet. Import a recovery phrase or attach a ZKas
          spending seed to an imported-key wallet.
        </p>
      )}
      {accounts?.map((entry) => {
        const wallet = walletSettings?.wallets.find(
          (item) => item.id === entry.walletId,
        );
        const account = wallet?.accounts.find(
          (item) => item.index === entry.accountIndex,
        );
        if (!wallet || !account) return null;
        const selected =
          isActive &&
          walletSettings?.selectedWalletId === entry.walletId &&
          walletSettings.selectedAccountIndex === entry.accountIndex;
        return (
          <button
            key={`${entry.walletId}:${entry.accountIndex}`}
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() => choose(entry)}
            className={`flex w-full flex-col gap-1 rounded-xl border bg-white/5 p-3 text-left text-white hover:border-white disabled:opacity-50 ${selected ? "border-icy-blue-400" : "border-daintree-700"}`}
          >
            <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
              <span>
                {wallet.name} · {account.name}
              </span>
              <span className="shrink-0 text-xs font-normal text-daintree-400">
                {entry.source === "importedSeed"
                  ? "Imported seed"
                  : "Recovery phrase"}
              </span>
            </span>
            <span className="text-xs text-daintree-400" title={entry.address}>
              {textEllipsis(entry.address)}
            </span>
          </button>
        );
      })}
    </section>
  );
}
