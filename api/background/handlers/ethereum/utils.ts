import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";
import * as secp from "@noble/secp256k1";
import { bytesToHex } from "viem";
import { ApiResponseSchema } from "@/api/message";

export const isMatchCurrentAddress = async (address: string) => {
  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    return false;
  }

  const publicKeyHex = account.publicKeys[0];
  const uncompressedHex = uncompressPublicKey(publicKeyHex);
  const ethAddress = publicKeyToAddress(uncompressedHex);
  return address.toLowerCase() === ethAddress.toLocaleLowerCase();
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
