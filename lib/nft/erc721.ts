import { Address } from "viem";

type Attribute = {
  trait_type: string;
  value: string;
};

export type NftAsset = {
  id: string;
  image_url?: string;
  metadata?: {
    attributes?: Attribute[];
    description?: string;
    name?: string;
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
