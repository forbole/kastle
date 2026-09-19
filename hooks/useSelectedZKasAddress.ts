import { useEffect, useState } from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useSettings } from "@/hooks/useSettings";
import useStorageState from "@/hooks/useStorageState";
import {
  getVisibleWalletNetworks,
  ZKAS_EXPERIMENTAL_KEY,
  ZKAS_MAINNET,
} from "@/lib/wallet-network";
import {
  getSelectedZKasAddress,
  type PublicZKasAccount,
} from "@/lib/zkas/popup-client";
import { requireSelectedZKasAddress } from "@/lib/zkas/selection";

type Result = {
  key: string;
  account: PublicZKasAccount | null;
  error: string;
  loading: boolean;
};

export default function useSelectedZKasAddress() {
  const { walletSettings } = useWalletManager();
  const [settings] = useSettings();
  const [enabled, , gateLoading] = useStorageState<boolean | null>(
    ZKAS_EXPERIMENTAL_KEY,
    null,
  );
  const walletId = walletSettings?.selectedWalletId;
  const accountIndex = walletSettings?.selectedAccountIndex;
  const visible =
    !gateLoading &&
    !!settings &&
    getVisibleWalletNetworks(settings, enabled).includes(ZKAS_MAINNET);
  const canLoad = visible && !!walletId && accountIndex !== undefined;
  const key = JSON.stringify([walletId, accountIndex, visible]);
  const [result, setResult] = useState<Result>({
    key: "",
    account: null,
    error: "",
    loading: false,
  });

  useEffect(() => {
    if (!canLoad) return;
    let current = true;
    setResult({ key, account: null, error: "", loading: true });
    void getSelectedZKasAddress()
      .then((account) => {
        if (current) {
          const selected = requireSelectedZKasAddress(account, {
            walletId: walletId!,
            accountIndex: accountIndex!,
            network: "mainnet",
          });
          setResult({ key, account: selected, error: "", loading: false });
        }
      })
      .catch((cause: unknown) => {
        if (current)
          setResult({
            key,
            account: null,
            error:
              cause instanceof Error
                ? cause.message
                : "Unable to load ZKas address",
            loading: false,
          });
      });
    return () => {
      current = false;
    };
  }, [key, canLoad, walletId, accountIndex]);

  const current = result.key === key;
  return {
    account: visible && current ? result.account : null,
    loading: canLoad && (!current || result.loading),
    error: visible && current ? result.error : "",
  };
}
