import { ApiUtils } from "@/api/background/utils";
import { ApiResponseSchema } from "@/api/message";

export const isMatchCurrentAddress = async (address: string) => {
  const evmAddress = await ApiUtils.getEvmAddress();
  return address.toLowerCase() === evmAddress.toLowerCase();
};

export const isUserDeniedResponse = (response: unknown) => {
  const result = ApiResponseSchema.safeParse(response);
  return result.success && result.data.error === "User denied";
};
