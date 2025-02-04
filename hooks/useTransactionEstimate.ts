import { PaymentOutput } from "@/lib/wallet/interface";
import { useState } from "react";
import { PublicKey } from "@/wasm/core/kaspa";
import { Account } from "@/contexts/WalletManagerContext.tsx";
import useDeepCompareEffect from "use-deep-compare-effect";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { TransactionEstimate } from "@/lib/wallet/interface.ts";

export default function useTransactionEstimate({
  account,
  outputs,
}: {
  account?: Account;
  outputs: PaymentOutput[];
}) {
  const { rpcClient, networkId, getUtxos, estimateTransactionFees } =
    useRpcClientStateful();
  const [transactionEstimate, setTransactionEstimate] =
    useState<TransactionEstimate>();

  useDeepCompareEffect(() => {
    async function estimate() {
      if (!account || !rpcClient || !networkId) {
        return;
      }

      const utxos = await getUtxos(
        account.publicKeys.map((pk) =>
          new PublicKey(pk).toAddress(networkId).toString(),
        ),
      );

      try {
        const estimate = await estimateTransactionFees(
          utxos,
          outputs,
          account.address,
        );
        setTransactionEstimate(estimate);
      } catch (e) {
        setTransactionEstimate(undefined);
        console.error("Failed to estimate transaction fees", e);
        return;
      }
    }

    estimate();
  }, [outputs, account]);

  return transactionEstimate;
}
