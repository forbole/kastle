import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import { hexToNumber } from "viem";

export const kasplexTestnet = {
  id: 167_012,
  name: "Kasplex Testnet",
  network: "kasplex-testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Bridged KAS",
    symbol: "WKAS",
  },
  rpcUrls: {
    default: { http: ["https://rpc.kasplextest.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Kasplex Testnet Explorer",
      url: "https://explorer.testnet.kasplextest.xyz",
    },
  },
  testnet: true,
};

export const TESTNET_SUPPORTED_EVM_L2_CHAINS = [kasplexTestnet];
export const MAINNET_SUPPORTED_EVM_L2_CHAINS = [];

export const ALL_SUPPORTED_EVM_L2_CHAINS = [
  ...MAINNET_SUPPORTED_EVM_L2_CHAINS,
  ...TESTNET_SUPPORTED_EVM_L2_CHAINS,
];

export const getChainImage = (chainId: `0x${string}`) => {
  if (hexToNumber(chainId) === kasplexTestnet.id) {
    return kasplexIcon;
  }

  return kasIcon;
};

export const getChainName = (chainId: `0x${string}`) => {
  switch (hexToNumber(chainId)) {
    case kasplexTestnet.id:
      return kasplexTestnet.name;
    default:
      return "Unknown Chain";
  }
};
