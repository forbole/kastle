import { KNS_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";
import { fetcher } from "@/lib/utils";
import useSWR from "swr";

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
  };
  pagination: Pagination;
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

export function useDomainsByAddress(
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

  const fetchDomainDetails = async (id: string) => {
    const response = await fetch(`${knsApiUrl}/api/v1/asset/${id}/detail`);
    if (!response.ok) {
      return undefined;
    }

    return (await response.json()).data as AssetDataWithId;
  };

  return { fetchDomainInfo: fetchDomainInfo, fetchDomainDetails };
}
