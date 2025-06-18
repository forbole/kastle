import { ApiUtils } from "@/api/background/utils";
import { ApiResponseSchema } from "@/api/message";
import { kairos } from "viem/chains";
import { toEvmAddress } from "@/lib/utils";

export const isMatchCurrentAddress = async (address: string) => {
  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    return false;
  }

  const publicKeyHex = account.publicKeys[0];
  const ethAddress = toEvmAddress(publicKeyHex);
  return address.toLowerCase() === ethAddress.toLowerCase();
};

export const isUserDeniedResponse = (response: unknown) => {
  const result = ApiResponseSchema.safeParse(response);
  return result.success && result.data.error === "User denied";
};

export const TESTNET_SUPPORTED_EVM_L2_CHAINS = [
  kairos,

  // Kasplex Testnet
  {
    id: 167_012,
    name: "Kasplex Network Testnet",
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
  },
];
