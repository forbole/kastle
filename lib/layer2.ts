import { hexToNumber } from "viem";
import kaspaIcon from "@/assets/images/network-logos/kaspa.svg";
import kasplexIcon from "@/assets/images/network-logos/kasplex.svg";
import igraIcon from "@/assets/images/network-logos/igra.svg";

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

export const igraTestnet = {
  id: 38_836,
  name: "IGRA Galleon Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "iKAS",
    symbol: "iKAS",
  },
  rpcUrls: {
    default: { http: ["https://galleon-testnet.igralabs.com:8545"] },
  },
  blockExplorers: {
    default: {
      name: "IGRA Galleon Testnet Explorer",
      url: "https://explorer.galleon-testnet.igralabs.com/",
    },
  },
  testnet: true,

  icon: igraIcon,
  apiUrl: "https://explorer.galleon-testnet.igralabs.com",
};

export const igraMainnet = {
  id: 38_837,
  name: "IGRA Galleon Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "iKAS",
    symbol: "iKAS",
  },
  rpcUrls: {
    default: { http: ["https://galleon.igralabs.com:8545"] },
  },
  blockExplorers: {
    default: {
      name: "IGRA Galleon Explorer",
      url: "https://explorer.galleon.igralabs.com",
    },
  },

  icon: igraIcon,
  apiUrl: "https://explorer.galleon.igralabs.com",
};

export const TESTNET_SUPPORTED_EVM_L2_CHAINS = [kasplexTestnet, igraTestnet];
export const MAINNET_SUPPORTED_EVM_L2_CHAINS = [kasplexMainnet, igraMainnet];

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

  return kaspaIcon;
};

export const getChainName = (chainId: `0x${string}`) => {
  const chainIdNumber = hexToNumber(chainId);
  const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find((c) => c.id === chainIdNumber);
  if (chain?.name) {
    return chain.name;
  }

  return "Unknown Chain";
};
