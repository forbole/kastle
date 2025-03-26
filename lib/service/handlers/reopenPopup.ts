import { Message } from "@/lib/service/extension-service.ts";

export type ReopenPopupRequest = { tabId: number };

export const reopenPopup = async (
  { tabId }: Message<ReopenPopupRequest>,
  sendResponse: (response: void) => void,
) => {
  await browser.tabs.remove(tabId);
  await browser.action.openPopup();

  sendResponse();
};
