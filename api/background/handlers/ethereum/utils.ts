import { ApiUtils } from "@/api/background/utils";
import { publicKeyToAddress } from "viem/accounts";

export const isMatchCurrentAddress = async (address: string) => {
  const account = await ApiUtils.getCurrentAccount();
  if (!account?.publicKeys) {
    return false;
  }

  const publicKey = account.publicKeys[0];
  const ethAddress = publicKeyToAddress(`0x${publicKey}` as `0x${string}`);
  return address === ethAddress;
};
