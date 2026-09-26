import { Transaction } from "@/wasm/core/kaspa";
import { IGRA_MAINNET_LANE_ID, IGRA_TX_ID_PREFIX } from "@/lib/bridge/bridge";

const MAX_NONCE_ATTEMPTS = 2_000_000;

/**
 * IGRA only credits an entry whose tx id starts with the network prefix, so
 * grind the payload's trailing 4-byte nonce until it does. Mainnet entries
 * also ride the KIP-21 lane: version 1, subnetwork = lane id, compute budget
 * per input. Same procedure as kastle-mobile's buildIgraEntryTransaction.
 */
export function mineIgraEntry(
  pendingSafeJson: string,
  basePayload: string,
  isMainnet: boolean,
): Transaction {
  let json = pendingSafeJson;
  if (isMainnet) {
    const data = JSON.parse(json);
    data.version = 1;
    data.subnetworkId = IGRA_MAINNET_LANE_ID.padEnd(40, "0");
    for (const input of data.inputs) {
      input.computeBudget = 10;
      input.sigOpCount = 0;
    }
    json = JSON.stringify(data);
  }

  const tx = Transaction.deserializeFromSafeJSON(json);
  const prefix = IGRA_TX_ID_PREFIX[isMainnet ? "mainnet" : "testnet"];
  let nonce = (Math.random() * 0xffffffff) >>> 0;
  for (let i = 0; i < MAX_NONCE_ATTEMPTS; i++) {
    tx.payload = basePayload.slice(0, -8) + nonce.toString(16).padStart(8, "0");
    tx.finalize();
    if (tx.id.startsWith(prefix)) return tx;
    nonce = (nonce + 1) >>> 0;
  }
  throw new Error("Could not mine an IGRA entry id, please try again");
}
