import {
  Address,
  IPaymentOutput,
  IUtxoEntry,
  kaspaToSompi,
  RpcClient,
  SighashType,
} from "@/wasm/core/kaspa";
import { PaymentOutput, SignType } from "@/lib/wallet/wallet-interface.ts";

/**
 * Patches a serialized transaction JSON to ensure all inputs have the
 * `computeBudget` field required by newer WASM versions.
 * Older serialized transactions (e.g. from external dApps using an older WASM)
 * may omit this field, causing deserialization to fail.
 */
export function patchTransactionJSON(txJson: string): string {
  try {
    const tx = JSON.parse(txJson);
    if (Array.isArray(tx.inputs)) {
      tx.inputs = tx.inputs.map((input: Record<string, unknown>) =>
        input.computeBudget === undefined
          ? { ...input, computeBudget: 0 }
          : input,
      );
    }
    return JSON.stringify(tx);
  } catch {
    return txJson;
  }
}

/**
 * Strips the `computeBudget` field from all inputs in a serialized transaction
 * JSON. Used before passing a new-WASM transaction to the legacy WASM for
 * signing on mainnet, since legacy WASM doesn't recognise this field.
 */
export function stripTransactionJSON(txJson: string): string {
  try {
    const tx = JSON.parse(txJson);
    if (Array.isArray(tx.inputs)) {
      tx.inputs = tx.inputs.map(
        ({ computeBudget: _cb, ...rest }: Record<string, unknown>) => rest,
      );
    }
    return JSON.stringify(tx);
  } catch {
    return txJson;
  }
}

// Sending amount must be greater than 0.2 KAS as KIP-0009 standard requires
// https://github.com/kaspanet/kips/blob/master/kip-0009.md
export const MIN_KAS_AMOUNT = 0.2;

export const SIGN_TYPE = {
  All: SighashType.All,
  None: SighashType.None,
  Single: SighashType.Single,
  AllAnyOneCanPay: SighashType.AllAnyOneCanPay,
  NoneAnyOneCanPay: SighashType.NoneAnyOneCanPay,
  SingleAnyOneCanPay: SighashType.SingleAnyOneCanPay,
} as const;

export function toSignType(signType: SignType): SighashType {
  return SIGN_TYPE[signType];
}

export function toKaspaPaymentOutput(output: PaymentOutput): IPaymentOutput {
  return {
    address: new Address(output.address),
    amount: kaspaToSompi(output.amount) ?? 0n,
  };
}

// Wait for the transaction to be added to the UTXO set of the address
export const waitTxForAddress = async (
  rpcClient: RpcClient,
  address: string,
  txId: string,
) => {
  try {
    await rpcClient.subscribeUtxosChanged([address]);

    await new Promise<void>((resolve, reject) => {
      const handleUtxosChanged = (event: any) => {
        const addedEntry: IUtxoEntry = event.data.added.find(
          (entry: IUtxoEntry) =>
            entry.address?.payload === new Address(address).payload,
        );

        const removedEntry: IUtxoEntry = event.data.removed.find(
          (entry: IUtxoEntry) =>
            entry.address?.payload === new Address(address).payload,
        );

        const isEventReceived =
          addedEntry?.outpoint.transactionId === txId ||
          removedEntry?.outpoint.transactionId === txId;

        if (isEventReceived) {
          rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
          resolve();
        }
      };

      rpcClient.addEventListener("utxos-changed", handleUtxosChanged);
      setTimeout(() => {
        rpcClient.removeEventListener("utxos-changed", handleUtxosChanged);
        reject(new Error("Timeout"));
      }, 120000); // 2 minutes
    });
  } finally {
    await rpcClient.unsubscribeUtxosChanged([address]);
  }
};
