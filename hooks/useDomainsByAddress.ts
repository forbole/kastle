import { KNS_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";
import { fetcher } from "@/lib/utils";
import useSWR from "swr";

interface Pagination {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface AssetsResponse {
  success: boolean;
  data: {
    assets: AssetData[];
  };
  pagination: Pagination;
}

export interface AssetData {
  mimeType: string;
  assetId: string;
  asset: string;
  owner: string;
  isDomain: boolean;
  isVerifiedDomain?: boolean;
  status: "default" | "listed";
}

export default function useDomainsByAddress(
  address?: string,
  refreshInterval?: number,
) {
  const { networkId } = useRpcClientStateful();

  const knsApiUrl = KNS_API_URLS[networkId ?? NetworkType.Mainnet];

  return useSWR<AssetsResponse, Error>(
    `${knsApiUrl}/api/v1/assets?owner=${address}&type=domain`,
    address
      ? fetcher
      : () => {
          return Promise.resolve(undefined);
        },
    { refreshInterval },
  );
}
