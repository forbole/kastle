import { ApiRequest, ApiResponse, RpcError, RPC_ERRORS } from "@/api/message";

export const chainIdHandler = async (
  tabId: number,
  message: ApiRequest,
  sendResponse: (response?: any) => void,
) => {
  // TODO: read ethereum chainId from the settings, now returns Goerli chainId
  sendResponse(new ApiResponse(message.id, "0x5"));
};
