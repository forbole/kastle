import { kairos } from "viem/chains";
import kairosIcon from "@/assets/images/kairos-icon.svg";
import kasIcon from "@/assets/images/kas-icon.svg";
import kasplexIcon from "@/assets/images/kasplex-icon.png";
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
      url: "https:/frontend.kasplextest.xyz",
    },
  },
  testnet: true,
};

export const TESTNET_SUPPORTED_EVM_L2_CHAINS = [kairos, kasplexTestnet];

export const ALL_SUPPORTED_EVM_L2_CHAINS = [...TESTNET_SUPPORTED_EVM_L2_CHAINS];

export const getChainImage = (chainId: `0x${string}`) => {
  if (hexToNumber(chainId) === kairos.id) {
    return kairosIcon;
  }

  if (hexToNumber(chainId) === kasplexTestnet.id) {
    return kasplexIcon;
  }

  return kasIcon;
};

export const getChainName = (chainId: `0x${string}`) => {
  switch (hexToNumber(chainId)) {
    case kairos.id:
      return kairos.name;
    case kasplexTestnet.id:
      return kasplexTestnet.name;
    default:
      return "Unknown Chain";
  }
};
