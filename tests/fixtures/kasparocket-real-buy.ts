import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KaspaRocket,
  parseAmounts,
  type ProtocolInfo,
  type Quote,
  type TransactionPlan,
} from "@kasparocket/sdk";

// REAL: one server-built buy (FOUR for a 160 KAS budget, 2026-11-26), whole:
// the /plan/trade plan, its server-prepared p2pkh sighashes, the matching
// /pool/quote answer, and the vendor's /protocol document. No network.
const dir = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));

const plan = load("kasparocket-plan.trade-buy-FOUR.real.json");
const sighashes = load("kasparocket-plan.trade-buy-FOUR.sighashes.real.json");
const quoteDoc = load("kasparocket-quote.trade-buy-FOUR.real.json");
const protocolDoc = load("kasparocket-protocol.real.json");

export const REAL_TOKEN_ID: string = plan.tokenId;
export const REAL_LP_COVENANT_ID: string = plan.lpCovenantId;
/** The wallet the plan was built for; no test holds its key. */
export const REAL_XONLY_PK: string = plan.xOnlyPk;
export const REAL_BUDGET_SOMPI = BigInt(quoteDoc.kasBudgetSompi);
/** Inputs less outputs of the real transaction. */
export const REAL_NETWORK_FEE_SOMPI = 18_658_300n;

export { REAL_LEADER_PROGRAM } from "./kasparocket-real-leader";

/** The server's p2pkh instructions: input index and prepared sighash. */
export const REAL_P2PKH: {
  inputIndex: number;
  kind: "p2pkh";
  sighash: string;
}[] = sighashes.signingInstructions;

/**
 * The real plan as the SDK hands it to the app (`parseAmounts`), with the
 * server's p2pkh signing instructions put back (the trimmed fixture carries
 * the covenant sigscripts already in its transaction). `edit` runs first, on
 * the raw JSON.
 */
export function realPlan(edit?: (raw: any) => void): TransactionPlan {
  const raw = JSON.parse(JSON.stringify(plan.plan));
  raw.transactions[0].signingInstructions = REAL_P2PKH.map((i) => ({
    ...i,
    sigscript: null,
    sigOffsets: [],
  }));
  edit?.(raw);
  return parseAmounts(raw) as TransactionPlan;
}

export const realProtocol = (edit?: (p: any) => void): ProtocolInfo => {
  const p = JSON.parse(JSON.stringify(protocolDoc.protocol));
  edit?.(p);
  return p;
};

/**
 * The real quote through the SDK's own `quote()`, its fetch answering the
 * recorded server response, so the snake_case mapping is the SDK's. Refuses
 * a request for any other budget.
 */
export async function realQuote(): Promise<Quote> {
  const client = new KaspaRocket({
    network: "mainnet",
    apiUrl: "http://offline.invalid/pro-api",
    catalogueUrl: "http://offline.invalid",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.kas_budget_sompi !== quoteDoc.kasBudgetSompi)
        throw new Error(`unexpected quote request ${init?.body}`);
      return new Response(JSON.stringify(quoteDoc.response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return client.quote({
    tokenId: REAL_TOKEN_ID,
    lpCovenantId: REAL_LP_COVENANT_ID,
    direction: "buy",
    kasBudgetSompi: REAL_BUDGET_SOMPI,
  });
}
