import { NetworkType } from "@/contexts/SettingsContext";
import { IGRA_KAS_VAULT_MAINNET } from "@/lib/bridge/igra-exit-abi";
import { KASPA_REST_APIS } from "@/lib/activity/externals";

// Ported from kastle-mobile lib/activity/exit-payout.ts — fetchVaultPayouts
// only. The rest of the mobile module matches LOCAL exit records to their L1
// payouts; the extension bridge never writes those records, so it was dead
// here. Kurve completion (kurve-completion.ts) is the remaining caller.
//
// ─── L1 payout detection for iKAS → KAS exits ────────────────────────────────
//
// The in-repo Igra exit ABI (lib/bridge/igra-exit-abi.ts) has no per-exit
// status getter and no completion event, so completion is observed the only
// way this repo can: the vault paying KAS to the exit's payout address on
// L1. A vault→user transaction newer than the exit's submission IS the payout;
// its hash is the Destination TX and its existence flips the row to Completed.

export interface PayoutCandidate {
  txHash: string;
  /** Amount actually received by the payout address, in sompi. */
  amountSompi: number;
  timeMs: number;
}

// The window is over the PAYOUT ADDRESS's own transaction history, not the
// vault's: any 50 newer transactions of any kind — sends, receives, unrelated
// KRC-20 activity — push older payouts out of it. On one mainnet test address
// with 566 transactions the newest 50 reach back only to 2026-06-18, so every
// exit older than that has an evicted payout (measured 2026-08-31).
//
// ponytail: NOT paginated on purpose. The page count grows with the user's own
// transaction count, not with their exits, and it would not fix the real
// damage anyway — an exit whose own payout is evicted can still fall inside a
// NEIGHBOUR's amount window and claim it.
const FETCH_LIMIT = 50;
/** Wall-clock bound per request; matches kat-registry's requestJson. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Transactions where `vault` paid `kaspaAddress` on L1. Same REST API
 * and response shape as hooks/kaspa/useKasTxHistory. Throws on HTTP/network
 * failure — callers degrade to "no completion info", never a broken feed.
 * Defaults to the Igra vault; the Kurve completion probe passes its own
 * hot-wallet address (lib/activity/kurve-completion.ts).
 */
export async function fetchVaultPayouts(
  kaspaAddress: string,
  vault: string = IGRA_KAS_VAULT_MAINNET,
): Promise<PayoutCandidate[]> {
  const url =
    `${KASPA_REST_APIS[NetworkType.Mainnet]}/addresses/${kaspaAddress}` +
    `/full-transactions?resolve_previous_outpoints=light&limit=${FETCH_LIMIT}`;
  // A hung socket must not hang the feed: without this the promise never
  // settles, and the activity screen's pull-to-refresh spinner never stops.
  // An abort rejects, which is the same failure path this function already
  // documents for HTTP errors, so callers degrade exactly as before.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`kaspa api ${res.status}`);
  const txs: Array<{
    transaction_id: string;
    accepting_block_time: number;
    inputs?: Array<{ previous_outpoint_address: string }>;
    outputs?: Array<{ script_public_key_address: string; amount: number }>;
  }> = await res.json();

  return txs
    .filter((tx) =>
      (tx.inputs ?? []).some(
        (i) => i.previous_outpoint_address === vault,
      ),
    )
    .map((tx) => ({
      txHash: tx.transaction_id,
      amountSompi: (tx.outputs ?? [])
        .filter((o) => o.script_public_key_address === kaspaAddress)
        .reduce((sum, o) => sum + o.amount, 0),
      timeMs: tx.accepting_block_time,
    }))
    .filter((c) => c.amountSompi > 0);
}
