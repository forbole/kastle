import { ApiRequestSchema, ApiRequestWithHostSchema } from "@/api/message";
import { EthereumAccountsChangedListener } from "@/api/content-script/listeners/ethereum/accountsChanged";
import { watchSettingsUpdated } from "@/api/content-script/listeners/kaspa/settings-updated";
import { watchWalletSettingsUpdated } from "@/api/content-script/listeners/kaspa/wallet-settings-updated";
import { ApiUtils } from "@/api/background/utils";

export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    // Emit the kastle_installed event to the page to notify that the extension is installed
    window.postMessage(
      ApiUtils.createApiResponse("kastle_installed", []),
      window.location.origin,
    );

    new EthereumAccountsChangedListener().start();

    watchSettingsUpdated();
    watchWalletSettingsUpdated();

    // Listen for messages from the browser
    window.addEventListener("message", async (event: MessageEvent<unknown>) => {
      const message = event.data;

      const result = ApiRequestSchema.safeParse(message);
      if (!result.success) {
        return;
      }

      const parsedMessage = ApiRequestSchema.parse(message);
      const messageWithHost = {
        ...parsedMessage,
        host: window.location.host,
      };
      const parsedMessageWithHost =
        ApiRequestWithHostSchema.parse(messageWithHost);

      // Send the message to the background script
      const response = await browser.runtime.sendMessage(parsedMessageWithHost);

      // Send the response back to the source
      window.postMessage(response, window.location.origin);
    });

    // Inject the script that will add the window.kastle object
    injectScript("/injected.js", {
      keepInDom: true,
    });
  },
});
