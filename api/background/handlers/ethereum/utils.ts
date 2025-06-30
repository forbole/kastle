import { ApiUtils } from "@/api/background/utils";
import { ApiResponseSchema } from "@/api/message";
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
