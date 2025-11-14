import { restApis } from "@/components/screens/Settings";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useSettings } from "./useSettings";
import useSWRInfinite from "swr/infinite";
import { fetcher, emptyFetcher } from "@/lib/utils";
import { useCallback } from "react";

const PAGE_SIZE = 20;

export type KaspaTxHistoryItem = {
  txHash: string;
  inputs: Array<{
    address: string;
    amount: number;
  }>;
  outputs: Array<{
    address: string;
    amount: number;
  }>;
};

function mapTxResponseToHistoryItem(
  tx: KaspaTxApiResponse,
): KaspaTxHistoryItem {
  return {
    txHash: tx.transaction_id,
    inputs: (tx.inputs || []).map((input) => ({
      address: input.previous_outpoint_address,
      amount: input.previous_outpoint_amount,
    })),
    outputs: (tx.outputs || []).map((output) => ({
      address: output.script_public_key_address,
      amount: output.amount,
    })),
  };
}

type InputResponse = {
  transaction_id: string;
  index: number;
  previous_outpoint_hash: string;
  previous_outpoint_index: string;
  previous_outpoint_address: string;
  previous_outpoint_amount: number;
  signature_script: string;
  sig_op_count: string;
};

type OutputResponse = {
  transaction_id: string;
  index: number;
  amount: number;
  script_public_key: string;
  script_public_key_address: string;
  script_public_key_type: string;
  accepting_block_hash: string;
};

// Kaspa full-transactions API response type
export type KaspaTxApiResponse = {
  subnetwork_id: string;
  transaction_id: string;
  hash: string;
  mass: string;
  payload: string;
  block_hash: string[];
  block_time: number;
  is_accepted: boolean;
  accepting_block_hash: string;
  accepting_block_blue_score: number;
  accepting_block_time: number;
  inputs: Array<InputResponse>;
  outputs: Array<OutputResponse>;
};

export default function useKasTxHistory(address?: string) {
  const [settings] = useSettings();

  const network = settings?.networkId ?? NetworkType.Mainnet;
  const restApi = restApis[network];

  const getKey = (
    pageIndex: number,
    previousPageData: KaspaTxApiResponse[] | null,
  ) => {
    if (!address) return null;
    if (previousPageData && previousPageData.length < PAGE_SIZE) return null;
    return `${restApi}/addresses/${address}/full-transactions?resolve_previous_outpoints=light&limit=${PAGE_SIZE}&offset=${pageIndex * PAGE_SIZE}`;
  };

  const { data, error, size, setSize, mutate } = useSWRInfinite<
    KaspaTxApiResponse[]
  >(getKey, address ? fetcher : emptyFetcher, {
    refreshInterval: 30_000,
    dedupingInterval: 5_000,
  });

  const txs = data ? data.flat().map(mapTxResponseToHistoryItem) : [];
  const isLoadingInitialData = !data && !error;
  const isLoadingMore =
    isLoadingInitialData ||
    (size > 0 && data && typeof data[size - 1] === "undefined");
  const isEmpty = data?.[0]?.length === 0;
  const hasNextPage =
    !isEmpty && data && data[data.length - 1]?.length === PAGE_SIZE;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isLoadingMore) {
      setSize((s) => s + 1);
    }
  }, [hasNextPage, isLoadingMore, setSize]);

  return {
    txs,
    error,
    isLoading: isLoadingInitialData,
    isLoadingMore,
    hasNextPage,
    loadMore,
    mutate,
  };
}
