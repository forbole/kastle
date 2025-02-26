import { useSettings } from "@/hooks/useSettings.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export interface DomainInfoResponse {
  success: boolean;
  data: Data;
}

export interface Data {
  id: string;
  assetId: string;
  asset: string;
  owner: string;
}

export function useKns() {
  const { networkId } = useRpcClientStateful();
  const [settings] = useSettings();

  const knsApiUrl = settings?.knsApiUrls[networkId ?? NetworkType.Mainnet];

  const fetchDomainInfo = async (domain: string) => {
    const response = await fetch(`${knsApiUrl}/api/v1/${domain}/owner`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as DomainInfoResponse;
  };

  return { fetchDomainInfo: fetchDomainInfo };
}
