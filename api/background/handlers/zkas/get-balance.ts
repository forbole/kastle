import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { getZKasDaemonOriginPattern, ZKasClient } from "@/lib/zkas/client";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { zkasKeyService } from "@/lib/zkas/key-service";

export const zkasGetBalanceHandler: Handler = async (
  _tabId,
  message,
  sendResponse,
) => {
  const origin = message.origin;
  if (!origin) throw new Error("ZKas website origin is missing");
  const credentials = await zkasKeyService.credentials();
  const selection = {
    walletId: credentials.walletId,
    accountIndex: credentials.accountIndex,
    network: credentials.network,
  };
  const assertConnected = async () => {
    const connections = await zkasConnectionStore.list();
    if (!hasZKasConnection(connections, origin, selection))
      throw new Error("Connect this website to ZKas first");
  };
  await assertConnected();
  if (!credentials.daemonUrl)
    throw new Error("Configure a ZKas daemon in Kastle first");
  const guard = async () => {
    await assertConnected();
    await zkasKeyService.checkSelection(
      selection,
      credentials.daemonUrl,
      credentials.keyringVersion,
    );
    const pattern = getZKasDaemonOriginPattern(credentials.daemonUrl!);
    if (!(await browser.permissions.contains({ origins: [pattern] }))) {
      throw new Error("Allow Kastle access to the ZKas daemon first");
    }
  };
  await guard();
  const client = new ZKasClient({
    baseUrl: credentials.daemonUrl,
    token: credentials.walletToken,
    network: credentials.network,
    guard,
  });
  const state = await client.state(
    credentials.fullViewingKeyHex,
    credentials.address,
  );
  await guard();
  sendResponse(
    ApiUtils.createApiResponse(message.id, {
      address: state.address,
      network: credentials.network,
      balanceSompi: state.balanceSompi.toString(),
      synced: state.synced,
      missingHistory: state.missingHistory,
    }),
  );
};
