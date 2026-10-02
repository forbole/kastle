import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { privateDaemonWebsiteBalance } from "@/lib/service/handlers/zkas-daemon-transport";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { zkasKeyService } from "@/lib/zkas/key-service";

export const zkasGetBalanceHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
) => {
  const origin = message.origin;
  if (!origin) throw new Error("ZKas website origin is missing");
  const account = await zkasKeyService.publicAccount();
  const selection = {
    walletId: account.walletId,
    accountIndex: account.accountIndex,
    network: account.network,
  };
  const assertConnected = async () => {
    const connections = await zkasConnectionStore.list();
    if (!hasZKasConnection(connections, origin, selection))
      throw new Error("Connect this website to ZKas first");
  };
  await assertConnected();
  await privateDaemonWebsiteBalance(account, origin, (balance) => {
    sendResponse(ApiUtils.createApiResponse(message.id, balance));
  });
};
