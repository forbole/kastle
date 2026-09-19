import type { Handler } from "@/api/background/utils";
import { ApiUtils } from "@/api/background/utils";
import { parseZkasSompi } from "@/lib/zkas/amount";
import { hasZKasConnection, zkasConnectionStore } from "@/lib/zkas/connection";
import { ZKAS_DAPP_ALARM_PREFIX, ZKAS_DAPP_TIMEOUT_MS, zkasDappPendingStore, type ZKasDappPending } from "@/lib/zkas/dapp-payment";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";
import { z } from "zod";

const SendRequestSchema = z.object({
  to: z.string().min(1).max(300),
  amountSompi: z.string(),
  maxFeeSompi: z.string(),
}).strict();

export const zkasSendHandler: Handler = async (tabId, message, sendResponse, sender) => {
  if (!message.origin || sender.frameId === undefined) throw new Error("ZKas website origin or frame is missing");
  const input = SendRequestSchema.parse(message.payload);
  if (parseZkasSompi(input.amountSompi) <= 0n || parseZkasSompi(input.maxFeeSompi) <= 0n) {
    throw new Error("ZKas amount and maximum fee must be positive");
  }
  const account = await zkasKeyService.publicAccount();
  if (account.network !== "mainnet") throw new Error("ZKas website payments require mainnet");
  if (!input.to.startsWith("zkas:")) throw new Error("ZKas recipient network does not match");
  if (!hasZKasConnection(await zkasConnectionStore.list(), message.origin, account)) {
    throw new Error("Connect this website to ZKas first");
  }
  await zkasKeyService.checkSelection(account);
  const approvalId = crypto.randomUUID();
  const pending: ZKasDappPending = {
    approvalId,
    pageRequestId: message.id,
    tabId,
    frameId: sender.frameId,
    origin: message.origin,
    account,
    to: input.to,
    amountSompi: input.amountSompi,
    maxFeeSompi: input.maxFeeSompi,
    createdAt: Date.now(),
  };
  await zkasDappPendingStore.acquire(pending);
  try {
    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = "/zkas-send";
    url.searchParams.set("approvalId", approvalId);
    const popup = await browser.windows.create({
      type: "popup",
      url: url.toString(),
      width: POPUP_WINDOW_WIDTH,
      height: POPUP_WINDOW_HEIGHT,
      focused: true,
    });
    if (popup.id === undefined) throw new Error("Unable to open ZKas payment approval");
    await zkasDappPendingStore.bindWindow(approvalId, popup.id);
    await browser.alarms.create(`${ZKAS_DAPP_ALARM_PREFIX}${approvalId}`, { when: Date.now() + ZKAS_DAPP_TIMEOUT_MS });
    sendResponse(ApiUtils.createApiResponse(message.id, { pending: true }));
  } catch (cause) {
    await zkasDappPendingStore.take(approvalId);
    throw cause;
  }
};
