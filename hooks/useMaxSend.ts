import { useCallback, useState } from "react";
import { sompiToKaspaString } from "@/wasm/core/kaspa";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useUtxoEntries } from "@/hooks/useKasFeeEstimate";
import { findMaxSendable } from "@/lib/sendFee";

// Max for the KAS send: the largest amount the Generator builds over every
// UTXO, priced against the batch's real fee. useFindMax (balance − a fee
// estimate) still serves the token sends.
export function useMaxSend(priorityFee: bigint) {
  const { account } = useWalletManager();
  const { networkId } = useRpcClientStateful();
  const { data: entries } = useUtxoEntries(account?.address);
  const [isComputing, setIsComputing] = useState(false);

  const computeMax = useCallback(async (): Promise<string | undefined> => {
    if (!entries || !account?.address || !networkId) return undefined;
    setIsComputing(true);
    try {
      const max = await findMaxSendable({
        entries,
        priorityFee,
        changeAddress: account.address,
        networkId,
      });
      if (!max) return "0";
      const [int, dec = ""] = sompiToKaspaString(max.amountSompi).split(".");
      return dec ? `${int}.${dec.slice(0, 8)}` : int;
    } finally {
      setIsComputing(false);
    }
  }, [account?.address, entries, networkId, priorityFee]);

  return { computeMax, isComputing, entries };
}
