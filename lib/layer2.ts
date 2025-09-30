import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import { hexToNumber, Chain } from "viem";

export const kasplexTestnet = {
  id: 167_012,
  name: "Kasplex Testnet",
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

  icon: kasplexIcon,
  apiUrl: "https://explorer.testnet.kasplextest.xyz",
};

export const kasplexMainnet = {
  id: 202_555,
  name: "Kasplex",
  network: "kasplex",
  nativeCurrency: {
    decimals: 18,
    name: "Bridged KAS",
    symbol: "WKAS",
  },
  rpcUrls: {
    default: { http: ["https://evmrpc.kasplex.org"] },
  },
  blockExplorers: {
    default: {
      name: "Kasplex Explorer",
      url: "https://explorer.kasplex.org",
    },
  },

  icon: kasplexIcon,
  apiUrl: "https://api-explorer.kasplex.org",
};

export const TESTNET_SUPPORTED_EVM_L2_CHAINS = [kasplexTestnet];
export const MAINNET_SUPPORTED_EVM_L2_CHAINS = [kasplexMainnet];

export const ALL_SUPPORTED_EVM_L2_CHAINS = [
  ...MAINNET_SUPPORTED_EVM_L2_CHAINS,
  ...TESTNET_SUPPORTED_EVM_L2_CHAINS,
];

export const getChainImage = (chainId: `0x${string}`) => {
  const chainIdNumber = hexToNumber(chainId);
  const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find((c) => c.id === chainIdNumber);
  if (chain?.icon) {
    return chain.icon;
  }

  return kasIcon;
};

export const getChainName = (chainId: `0x${string}`) => {
  const chainIdNumber = hexToNumber(chainId);
  const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find((c) => c.id === chainIdNumber);
  if (chain?.name) {
    return chain.name;
  }

  return "Unknown Chain";
};
