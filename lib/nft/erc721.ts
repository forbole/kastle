import { Address } from "viem";
import { convertIPFStoHTTP } from "@/lib/utils";

type Attribute = {
  trait_type: string;
  value: string;
};

export type NftAsset = {
  id: string;
  image_url?: string;
  media_url?: string;
  metadata?: {
    attributes?: Attribute[];
    description?: string;
    name?: string;
    image?: string;
  };
  token: {
    address_hash: Address;
    type?: "ERC-721" | "ERC-1155" | "ERC-404";
    name?: string;
    symbol?: string;
  };
  value?: string; // For ERC-1155 (quantity) and ERC-404 (balance)
  owner?: {
    hash: Address;
  };
};

// Blockscout's image_url is pre-rewritten to its own gateway; prefer raw metadata.image so we control the gateway/cache path.
export function getNftImageUrl(asset?: NftAsset): string | undefined {
  const raw = asset?.metadata?.image ?? asset?.media_url ?? asset?.image_url;
  if (!raw) return undefined;
  return raw.startsWith("ipfs://") ? convertIPFStoHTTP(raw) : raw;
}
