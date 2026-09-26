import { Address } from "viem";

/** KAT Igra Bridge FeeCollector on IGRA Mainnet (chainId: 38833) */
export const KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS: Address =
  "0x9d01E8a2f3DD0B1Fc739d32ca8d79509b501eAb8";

export const FEE_COLLECTOR_BRIDGE_ABI = [
  {
    name: "bridgeToL1",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "kaspaAddress", type: "string" }],
    outputs: [],
  },
  {
    name: "feeRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
