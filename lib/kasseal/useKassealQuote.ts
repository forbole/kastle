import { useMemo } from "react";
import useSWR from "swr";
import {
  createApiSources,
  createTxBuilder,
  poolMathState,
} from "@kassealhq/sdk";
import type { CurveParams, KassealNetwork, PoolState } from "@kassealhq/sdk";
import { fetchLaunchProof, kassealBaseUrl, KassealToken } from "./api";
import { initKasseal } from "./init";
import {
  BoundProof,
  KassealQuote,
  KassealSide,
  quoteCurve,
  quotePool,
  requireBoundProof,
} from "./trade";

export interface KassealMarket {
  proof: BoundProof;
  curve?: CurveParams;
  pool?: PoolState;
}

/** Builder sources for one trader; `required` pins rebuild funding. */
export function kassealBuilder(
  network: KassealNetwork,
  tokenId: string,
  ownKey: string,
  required?: ReadonlySet<string>,
) {
  const sources = createApiSources({
    baseUrl: kassealBaseUrl(network),
    network,
    tokenId,
    ownKey,
  });
  const builder = createTxBuilder({
    sources,
    networkId: network,
    fundingOptions: required ? { required } : undefined,
  });
  return { sources, builder, lastFunding: sources.lastFunding };
}

/** Loads the SDK, verifies the launch proof, and reads the venue's pricing state. */
export function useKassealMarket(
  network: KassealNetwork | undefined,
  token: KassealToken | undefined,
  ownKey: string | undefined,
) {
  const venue = token?.phase === "bonding" ? "curve" : "pool";
  return useSWR(
    network && token && ownKey
      ? [
          "kassealMarket",
          network,
          token.covenantId,
          venue,
          token.curve?.lotsSold,
        ]
      : null,
    async (): Promise<KassealMarket> => {
      await initKasseal(network!);
      const json = await fetchLaunchProof(
        kassealBaseUrl(network!),
        token!.covenantId,
      );
      const proof = requireBoundProof(json, network!, token!.covenantId);
      const { sources, builder } = kassealBuilder(
        network!,
        proof.tokenId,
        ownKey!,
      );
      if (venue === "curve") {
        const curve = await builder.curveParams({
          covenantId: proof.tokenId,
          tokenId: proof.tokenId,
        });
        return { proof, curve };
      }
      if (!proof.poolId) return { proof };
      const cell = await sources.poolCell(proof.poolId);
      return {
        proof,
        pool: poolMathState({
          kind: "pool",
          outpoint: cell.outpoint,
          value: cell.amount,
          covenantId: cell.covenantId,
          program: cell.redeemScript,
          state: cell.state,
          daaScore: 0n,
        }),
      };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
}

export function useKassealQuote(
  side: KassealSide,
  token: KassealToken | undefined,
  market: KassealMarket | undefined,
  amountIn: bigint | undefined,
  slippageBps: number,
): { quote?: KassealQuote; error?: unknown } {
  return useMemo(() => {
    if (!token || !market || !amountIn || amountIn <= 0n) return {};
    try {
      if (market.curve && token.curve) {
        return {
          quote: quoteCurve(
            side,
            market.curve,
            BigInt(token.curve.lotsSold),
            token.curve.lotSize,
            amountIn,
            slippageBps,
          ),
        };
      }
      if (market.pool)
        return { quote: quotePool(side, market.pool, amountIn, slippageBps) };
      return {};
    } catch (error) {
      return { error };
    }
  }, [side, token, market, amountIn, slippageBps]);
}
