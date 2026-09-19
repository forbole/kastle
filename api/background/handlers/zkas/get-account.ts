import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { zkasKeyService } from "@/lib/zkas/key-service";

export const zkasGetAccountHandler: Handler = async (_tabId, message, sendResponse) => {
  const account = await zkasKeyService.publicAccount();
  const connections = await zkasConnectionStore.list();
  if (!message.origin || !hasZKasConnection(connections, message.origin, account)) {
    throw new Error("Connect this website to ZKas first");
  }
  await zkasKeyService.checkSelection(account);
  sendResponse(ApiUtils.createApiResponse(message.id, {
    address: account.address,
    network: account.network,
  }));
};
