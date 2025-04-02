import { ApiRequestSchema, ApiRequestWithHostSchema } from "@/api/message";
import { EthereumAccountsChangedListener } from "@/api/content-script/listeners/ethereum/accountsChanged";

export default defineContentScript({
  matches: ["*://*/*"],
  async main() {
    // Inject the script that will add the window.kastle object
    await injectScript("/injected.js", {
      keepInDom: true,
    });

    // TODO: implement tabs connections manager and authentication for listeners
    new EthereumAccountsChangedListener().start();

    // Listen for messages from the source
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
  },
});
