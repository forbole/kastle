import { useCallback, useMemo } from "react";
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
  KASSEAL_POOL_SWR,
  kassealMarketKey,
  kassealPoolKey,
  venueOf,
} from "./market";
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
  const base = useSWR(
    kassealMarketKey(network, token, ownKey),
    async (): Promise<KassealMarket> => {
      await initKasseal(network!);
      const json = await fetchLaunchProof(
        kassealBaseUrl(network!),
        token!.covenantId,
      );
      const proof = requireBoundProof(json, network!, token!.covenantId);
      if (venueOf(token!) === "pool") return { proof };
      const { builder } = kassealBuilder(network!, proof.tokenId, ownKey!);
      const curve = await builder.curveParams({
        covenantId: proof.tokenId,
        tokenId: proof.tokenId,
      });
      return { proof, curve };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const poolId = base.data?.proof.poolId;
  const pool = useSWR(
    kassealPoolKey(network, token, poolId),
    async (): Promise<PoolState> => {
      const { sources } = kassealBuilder(network!, token!.covenantId, ownKey!);
      const cell = await sources.poolCell(poolId!);
      return poolMathState({
        kind: "pool",
        outpoint: cell.outpoint,
        value: cell.amount,
        covenantId: cell.covenantId,
        program: cell.redeemScript,
        state: cell.state,
        daaScore: 0n,
      });
    },
    KASSEAL_POOL_SWR,
  );

  const needsPool = !!token && venueOf(token) === "pool" && !!poolId;
  const data = useMemo(
    () =>
      base.data && (!needsPool || pool.data)
        ? { ...base.data, pool: pool.data }
        : undefined,
    [base.data, needsPool, pool.data],
  );
  const { mutate: mutateBase } = base;
  const { mutate: mutatePool } = pool;
  return {
    data,
    error: base.error ?? pool.error,
    isLoading: base.isLoading || pool.isLoading,
    refresh: useCallback(
      () => Promise.all([mutateBase(), mutatePool()]),
      [mutateBase, mutatePool],
    ),
  };
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
