import { KNS_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";
import { fetcher } from "@/lib/utils";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

export interface DomainInfoResponse {
  success: boolean;
  data: DomainData;
}

export interface DomainData {
  id: string;
  assetId: string;
  asset: string;
  owner: string;
}

export interface DomainDetailsResponse {
  success: boolean;
  data: AssetDataWithId;
}

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
    pagination: Pagination;
  };
}

export interface AssetDataWithId extends AssetData {
  id: string;
}

export interface AssetData {
  mimeType: string;
  assetId: string;
  asset: string;
  owner: string;
  isDomain: boolean;
  isVerifiedDomain?: boolean;
  status: "default" | "listed";
  creationBlockTime: string;
}

export function useAssetsByAddress(
  assetType: "domain" | "text",
  address?: string,
  refreshInterval?: number,
) {
  const { networkId } = useRpcClientStateful();

  const knsApiUrl = KNS_API_URLS[networkId ?? NetworkType.Mainnet];

  const getKey = (
    pageIndex: number,
    previousPageData: AssetsResponse | undefined,
  ) => {
    if (pageIndex === 0) {
      return `${knsApiUrl}/api/v1/assets?owner=${address}&type=${assetType}`;
    }
    if (!previousPageData || !previousPageData.data.pagination) {
      return null;
    }
    const nextPage = previousPageData.data.pagination.currentPage + 1;
    return `${knsApiUrl}/api/v1/assets?owner=${address}&type=${assetType}&page=${nextPage}`;
  };

  return useSWRInfinite<AssetsResponse, Error>(getKey, {
    fetcher: address ? fetcher : undefined,
    refreshInterval,
  });
}

export function useAssetDetails(id?: string, refreshInterval?: number) {
  const { networkId } = useRpcClientStateful();

  const knsApiUrl = KNS_API_URLS[networkId ?? NetworkType.Mainnet];

  return useSWR<DomainDetailsResponse, Error>(
    `${knsApiUrl}/api/v1/asset/${id}/detail`,
    id
      ? fetcher
      : () => {
          return Promise.resolve(undefined);
        },
    { refreshInterval },
  );
}

export function useKns() {
  const { networkId } = useRpcClientStateful();

  const knsApiUrl = KNS_API_URLS[networkId ?? NetworkType.Mainnet];

  const fetchDomainInfo = async (domain: string) => {
    const response = await fetch(`${knsApiUrl}/api/v1/${domain}/owner`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as DomainInfoResponse;
  };

  return { fetchDomainInfo: fetchDomainInfo };
}
