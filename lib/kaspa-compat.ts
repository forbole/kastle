/**
 * Always uses new WASM for deserialization. patchTransactionJSON adds missing
 * `computeBudget` for old dApp txJson on both mainnet and testnet.
 * Mainnet signing compatibility is handled at the account layer
 * (see lib/wallet/account/legacy/).
 */
import { Transaction } from "@/wasm/core/kaspa";
import { patchTransactionJSON } from "@/lib/kaspa";

export function deserializeTransaction(txJson: string): Transaction {
  return Transaction.deserializeFromSafeJSON(patchTransactionJSON(txJson));
}
