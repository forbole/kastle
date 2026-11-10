import type { KaspaTxHistoryItem } from "@/hooks/useKasTxHistory";
import type { NetworkType } from "@/contexts/SettingsContext";
import { explorerTxLinks } from "@/components/screens/Settings";
import type { HistoryRecord } from "@/lib/history/types";

const NONE = { value: null, quality: "unavailable" } as const;
const SOMPI = 100_000_000n;

const sum = (side: KaspaTxHistoryItem["inputs"], own: string) =>
  side
    .filter((x) => x.address === own)
    .reduce((acc, x) => acc + BigInt(x.amount), 0n);

const others = (side: KaspaTxHistoryItem["inputs"], own: string) => [
  ...new Set(side.map((x) => x.address).filter((a) => a && a !== own)),
];

/**
 * The REST API carries no fee or KAS leg, so those stay unavailable. Fiat is
 * derived from the current price, hence approximate.
 */
export function toHistoryRecord(
  tx: KaspaTxHistoryItem,
  ownAddress: string,
  opts: { network: NetworkType; usdPrice?: number },
): HistoryRecord {
  const net = sum(tx.outputs, ownAddress) - sum(tx.inputs, ownAddress);
  const direction = net < 0n ? "out" : net > 0n ? "in" : "self";
  const abs = net < 0n ? -net : net;
  const parties =
    direction === "out"
      ? others(tx.outputs, ownAddress)
      : direction === "in"
        ? others(tx.inputs, ownAddress)
        : [];
  const usdPrice = opts.usdPrice ?? 0;
  const kas = Number(abs / SOMPI) + Number(abs % SOMPI) / 1e8;

  return {
    id: tx.txHash,
    family: "kas",
    txid: tx.txHash,
    kind:
      direction === "out" ? "send" : direction === "in" ? "receive" : "self",
    direction,
    amount: {
      value: { raw: abs.toString(), decimals: 8, symbol: "KAS" },
      quality: "exact",
    },
    kasLeg: NONE,
    fiat:
      usdPrice > 0
        ? { value: { usd: kas * usdPrice }, quality: "approximate" }
        : NONE,
    time: {
      value: tx.timeMs,
      quality: tx.timeMs === null ? "unavailable" : "exact",
    },
    // Several or no other parties: name none rather than the wrong one.
    counterparty:
      parties.length === 1
        ? { value: { address: parties[0] }, quality: "exact" }
        : NONE,
    fee: NONE,
    status: tx.isAccepted ? "finalized" : "pending",
    explorer: { url: `${explorerTxLinks[opts.network]}${tx.txHash}` },
  };
}
