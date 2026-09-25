import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { isKeyringInitialized } from "@/api/background/keyring-status";
import { ApiResponseSchema } from "@/api/message";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { sameZKasSelection } from "@/lib/zkas/selection";
import { createZKasApprovalSession } from "@/api/background/zkas-approval";
import { z } from "zod";
import { SETTINGS_KEY, type Settings } from "@/contexts/SettingsContext";
import { assertZKasActive, ZKAS_EXPERIMENTAL_KEY } from "@/lib/wallet-network";

const ApprovedAccountSchema = z.object({
  walletId: z.string(),
  accountIndex: z.number().int().nonnegative(),
  network: z.enum(["mainnet", "testnet"]),
  address: z.string(),
});

export const zkasConnectHandler: Handler = async (
  tabId,
  message,
  sendResponse,
) => {
  const origin = message.origin;
  if (!origin) throw new Error("ZKas website origin is missing");
  const [settings, enabled] = await Promise.all([
    storage.getItem<Settings>(SETTINGS_KEY),
    storage.getItem<boolean>(ZKAS_EXPERIMENTAL_KEY),
  ]);
  assertZKasActive(settings, enabled);
  if (!(await isKeyringInitialized()))
    throw new Error("Initialize Kastle first");
  try {
    const [account, connections] = await Promise.all([
      zkasKeyService.publicAccount(),
      zkasConnectionStore.list(),
    ]);
    if (hasZKasConnection(connections, origin, account)) {
      sendResponse(ApiUtils.createApiResponse(message.id, true));
      return;
    }
  } catch {
    // The approval window can unlock Kastle or explain an unsupported account.
  }
  // Page request IDs are attacker-controlled and may collide across sites.
  // The approval channel uses a fresh background-generated ID instead.
  const approval = createZKasApprovalSession(message.id, origin);
  const url = new URL(browser.runtime.getURL("/popup.html"));
  url.hash = "/zkas-connect";
  url.searchParams.set("origin", approval.origin);
  url.searchParams.set("requestId", approval.approvalId);
  const response = ApiResponseSchema.parse(
    await ApiUtils.openPopupAndListenForResponse(
      approval.approvalId,
      url.toString(),
      tabId,
      180_000,
      false,
    ),
  );
  if (response.error) {
    sendResponse(ApiUtils.createApiResponse(message.id, null, response.error));
    return;
  }
  const approved = ApprovedAccountSchema.parse(response.response);
  const current = await zkasKeyService.publicAccount();
  if (
    !sameZKasSelection(approved, current) ||
    approved.address !== current.address
  ) {
    throw new Error(
      "Selected ZKas account changed. Review the connection again.",
    );
  }
  await zkasConnectionStore.add(origin, current);
  sendResponse(ApiUtils.createApiResponse(message.id, true));
};
