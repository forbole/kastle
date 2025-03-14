import { KNS_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

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
