export const NetworkType = {
  Mainnet: "mainnet",
  TestnetT10: "testnet-10",
} as const;

export type NetworkType = (typeof NetworkType)[keyof typeof NetworkType];
