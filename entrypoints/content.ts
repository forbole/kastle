import {
  ApiRequestSchema,
  ApiRequestWithHostSchema,
  ZKasDappResultSchema,
} from "@/api/message";
import { EthereumAccountsChangedListener } from "@/api/content-script/listeners/ethereum/accountsChanged";
import { EthereumChainChangedListener } from "@/api/content-script/listeners/ethereum/chainChanged";
import { watchSettingsUpdated } from "@/api/content-script/listeners/kaspa/settings-updated";
import { watchWalletSettingsUpdated } from "@/api/content-script/listeners/kaspa/wallet-settings-updated";
import { isTrustedZKasPageMessage } from "@/api/content-script/zkas-page-message";

export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    // Listen for messages from the browser
    window.addEventListener("message", async (event: MessageEvent<unknown>) => {
      if (!isTrustedZKasPageMessage(event.source, event.origin, window)) {
        return;
      }
      const message = event.data;

      const result = ApiRequestSchema.safeParse(message);
      if (!result.success) {
        return;
      }

      const parsedMessage = ApiRequestSchema.parse(message);
      const messageWithHost = {
        ...parsedMessage,
        host: window.location.host,
        origin: window.location.origin,
      };
      const parsedMessageWithHost =
        ApiRequestWithHostSchema.parse(messageWithHost);

      // Send the message to the background script
      const response = await browser.runtime.sendMessage(parsedMessageWithHost);

      // Send the response back to the source
      window.postMessage(response, window.location.origin);
    });

    browser.runtime.onMessage.addListener(
      (message: unknown, sender, sendResponse) => {
        const result = ZKasDappResultSchema.safeParse(message);
        if (!result.success || sender.id !== browser.runtime.id) return;
        if (result.data.origin !== window.location.origin) {
          sendResponse({ accepted: false });
          return;
        }
        window.postMessage(result.data.response, window.location.origin);
        sendResponse({ accepted: true, origin: window.location.origin });
      },
    );

    new EthereumAccountsChangedListener().start();
    new EthereumChainChangedListener().start();

    watchSettingsUpdated();
    watchWalletSettingsUpdated();

    // Notify the page that Kastle is ready
    window.dispatchEvent(new Event("kastle#initialized"));
  },
  runAt: "document_end",
});
