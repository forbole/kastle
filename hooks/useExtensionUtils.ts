import { sendMessage } from "@/lib/utils.ts";
import { Method } from "@/lib/service/extension-service.ts";
import { ReopenPopupRequest } from "@/lib/service/handlers/reopenPopup.ts";

export default function useExtensionUtils() {
  return {
    reopenPopup: async () => {
      const tab = await browser.tabs.getCurrent();
      if (!tab?.id) {
        return;
      }

      return sendMessage<void>(Method.REOPEN_POPUP, {
        tabId: tab.id,
      } satisfies ReopenPopupRequest);
    },
  };
}
