import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";
import * as secp from "@noble/secp256k1";
import { bytesToHex } from "viem";
import { ApiResponseSchema } from "@/api/message";
import { kairos, mainnet } from "viem/chains";

export const isMatchCurrentAddress = async (address: string) => {
  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    return false;
  }

  const publicKeyHex = account.publicKeys[0];
  const uncompressedHex = uncompressPublicKey(publicKeyHex);
  const ethAddress = publicKeyToAddress(uncompressedHex);
  return address.toLowerCase() === ethAddress.toLowerCase();
};

export const uncompressPublicKey = (publicKey: string) => {
  const uncompressed =
    secp.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  return bytesToHex(uncompressed);
};

export const isUserDeniedResponse = (response: unknown) => {
  const result = ApiResponseSchema.safeParse(response);
  return result.success && result.data.error === "User Denied";
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
