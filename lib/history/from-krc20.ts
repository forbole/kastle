import type { Op } from "@/hooks/useOpListByAddressAndTicker";
import type { NetworkType } from "@/contexts/SettingsContext";
import { explorerTxLinks } from "@/components/screens/Settings";
import type { HistoryRecord } from "@/lib/history/types";

const NONE = { value: null, quality: "unavailable" } as const;

/**
 * Kasplex oplist row → shared record. `amt`/`pre` are base-unit integer
 * strings; the API carries no fee or KAS leg. Fiat is from the current price,
 * hence approximate.
 */
export function toHistoryRecord(
  op: Op,
  ctx: {
    ownAddress: string;
    tick: string;
    decimals: number;
    network: NetworkType;
    usdPrice?: number;
  },
): HistoryRecord {
  const kind =
    op.op === "transfer"
      ? op.from === ctx.ownAddress && op.to === ctx.ownAddress
        ? "self"
        : op.to === ctx.ownAddress
          ? "receive"
          : "send"
      : op.op === "deploy" || op.op === "mint"
        ? op.op
        : "unknown";
  const direction =
    // A deploy credits its premint `pre` to the deployer: a receipt.
    kind === "receive" || kind === "mint" || kind === "deploy"
      ? "in"
      : kind === "send"
        ? "out"
        : "self";

  const src =
    op.op === "deploy"
      ? op.pre
      : op.op === "transfer" || op.op === "mint"
        ? op.amt
        : undefined;
  // Unparsable stays null — never a 0. A deploy without a premint has no
  // figure at all, never "+0 TICK".
  const raw =
    src && /^\d+$/.test(src) && (op.op !== "deploy" || BigInt(src) > 0n)
      ? src
      : null;
  const big = raw === null ? null : BigInt(raw);
  const scale = 10n ** BigInt(ctx.decimals);
  const float =
    big === null
      ? null
      : Number(big / scale) + Number(big % scale) / 10 ** ctx.decimals;
  const usdPrice = ctx.usdPrice ?? 0;

  const timeMs = parseInt(op.mtsAdd, 10);
  const party =
    kind === "send" ? op.to : kind === "receive" ? op.from : undefined;
  const txid = op.hashRev ? op.hashRev : null;

  return {
    id: `${op.hashRev}:${op.mtsAdd}:${op.op}`,
    family: "krc20",
    txid,
    kind,
    direction,
    amount:
      raw === null
        ? NONE
        : {
            value: {
              raw,
              decimals: ctx.decimals,
              symbol: ctx.tick,
            },
            quality: "exact",
          },
    kasLeg: NONE,
    fiat:
      float !== null && usdPrice > 0
        ? { value: { usd: float * usdPrice }, quality: "approximate" }
        : NONE,
    time: Number.isFinite(timeMs) ? { value: timeMs, quality: "exact" } : NONE,
    counterparty: party
      ? { value: { address: party }, quality: "exact" }
      : NONE,
    fee: NONE,
    // The screen only passes opAccept === "1" rows.
    status: "finalized",
    explorer: txid ? { url: `${explorerTxLinks[ctx.network]}${txid}` } : null,
  };
}
