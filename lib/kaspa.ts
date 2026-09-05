import {
  Address,
  IPaymentOutput,
  IUtxoEntry,
  kaspaToSompi,
  PublicKey,
  RpcClient,
  SighashType,
} from "@/wasm/core/kaspa";
import { PaymentOutput, SignType } from "@/lib/wallet/wallet-interface.ts";
import type { NetworkType } from "@/contexts/SettingsContext";

// Single source of truth for deriving a Kaspa address from an account's
// stored public key, used both when caching addresses on network switch
// (WalletManagerContext.refreshKaspaAddresses) and when reading an account
// (ApiUtils.getSelectedAccountFromSettings), so the two can't drift.
export function deriveKaspaAddress(
  publicKeys: string[] | undefined,
  networkId: NetworkType,
): string | undefined {
  if (!publicKeys?.length) {
    return undefined;
  }
  return new PublicKey(publicKeys[0]).toAddress(networkId).toString();
}

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

// The Generator aborts instead of retrying with fewer inputs once a fragmented
// UTXO set pushes a transaction past KIP-9 storage mass (rusty-kaspa#701, still
// open in the vendored 2.0.1). Measured against assets/kaspa_bg.wasm, sending
// balance − 0.3 KAS: 175–176 UTXOs → "Mass calculation error", 177–~265 →
// "Storage mass exceeds maximum", ≳268 → "Insufficient funds". Three strings,
// one user-facing condition, one remedy: send less.
export const isFragmentationError = (error: unknown) =>
  /Mass calculation error|Storage mass exceeds maximum|Insufficient funds/.test(
    String(error),
  );

// What a Max send keeps back, before the priority fee: the Generator's fee for
// spending every UTXO (0.19931 KAS at 174, the most it builds) plus the ~0.1 KAS
// of change the storage mass limit demands. Measured against
// assets/kaspa_bg.wasm; tests/generator-errors-unit.spec.ts pins it.
export const MAX_SEND_RESERVE_KAS = 0.3;

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
  // own-property check: bare indexing would resolve inherited keys like
  // "toString" or "__proto__" to functions instead of rejecting them
  if (!Object.prototype.hasOwnProperty.call(SIGN_TYPE, signType)) {
    throw new Error(`signTx: unsupported signType "${signType}"`);
  }
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
