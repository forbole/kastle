import useSWR from "swr";
import { finalize } from "@kassealhq/sdk";
import type { KassealNetwork } from "@kassealhq/sdk";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { fetchTxStatus, kassealBaseUrl, KassealToken, postTx } from "./api";
import { venueOf } from "./market";
import {
  kassealBuilder,
  useKassealMarket,
  useKassealQuote,
} from "./useKassealQuote";
import {
  boundKind,
  buildTrade,
  KassealAttempt,
  KassealQuote,
  KassealSide,
  submitKassealTrade,
} from "./trade";
import { signKassealTx } from "./sign";

/**
 * A Kasseal trade inside the Swap screen. The quote is local curve or pool
 * math: nothing is built until confirm, so the network fee is unknown here.
 */
export default function useKassealSwap(
  network: KassealNetwork | undefined,
  token: KassealToken | undefined,
  side: KassealSide,
  amountIn: bigint | undefined,
  slippage: number,
  signer: IWallet | undefined,
  address: string | undefined,
) {
  const { data: ownKey } = useSWR(
    token && signer && address ? ["kassealOwnKey", address] : null,
    async () => (await signer!.getPublicKey()).toXOnlyPublicKey().toString(),
  );
  const market = useKassealMarket(network, token, ownKey);
  const slippageBps = Math.round(slippage * 100);
  const { quote, error } = useKassealQuote(
    side,
    token,
    market.data,
    amountIn,
    slippageBps,
  );

  /** One press of Confirm; `persist` saves the attempt before each POST. */
  const submit = (
    reviewed: KassealQuote,
    attempt: KassealAttempt,
    persist: (attempt: KassealAttempt) => Promise<void>,
  ) => {
    const proof = market.data?.proof;
    if (!network || !proof || !signer || !address || !ownKey)
      return Promise.reject(new Error("Kasseal market is not ready"));
    const baseUrl = kassealBaseUrl(network);
    const xOnlyPubkey = Uint8Array.from(
      ownKey.match(/../g)!.map((b) => parseInt(b, 16)),
    );
    return submitKassealTrade(
      {
        makeBuilder: (required) =>
          kassealBuilder(network, proof.tokenId, ownKey, required),
        build: (builder) =>
          buildTrade(builder, proof, { address, xOnlyPubkey }, reviewed),
        sign: async (built) =>
          finalize(built, await signKassealTx(signer, built)),
        post: (built) => postTx(baseUrl, built.txid, built.txJson),
        status: (txid) => fetchTxStatus(baseUrl, txid),
        persist,
      },
      attempt,
    );
  };

  return {
    quote,
    error: market.error ?? error,
    isLoading: market.isLoading,
    venue: token && venueOf(token),
    boundKind: quote && boundKind(quote),
    refresh: market.refresh,
    submit,
  };
}
