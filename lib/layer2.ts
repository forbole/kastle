import { kairos } from "viem/chains";

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
