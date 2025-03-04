import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings.ts";
import { KASPLEX_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export interface Op {
  p: string;
  op: string;
  tick: string;
  amt: string;
  pre: string;
  from: string;
  to?: string;
  opScore: string;
  hashRev: string;
  feeRev: string;
  txAccept: string;
  opAccept: string;
  opError: string;
  checkpoint: string;
  mtsAdd: string;
  mtsMod: string;
  price?: string;
  utxo?: string;
}

interface OpListResponse {
  message: string;
  prev: string;
  next: string;
  result: Op[];
}

type UseOpListByAddressAndTickerParams =
  | { ticker: string; address: string }
  | undefined;

export function useOpListByAddressAndTicker(
  params: UseOpListByAddressAndTickerParams,
) {
  const [settings] = useSettings();

  const kasplexUrl =
    KASPLEX_API_URLS[settings?.networkId ?? NetworkType.Mainnet];

  return useSWR<OpListResponse, Error>(
    kasplexUrl && params
      ? `${kasplexUrl}/krc20/oplist?address=${params.address}&tick=${params.ticker}`
      : null,
    fetcher,
  );
}
