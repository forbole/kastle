import { ApiRequest } from "@/api/message";

export default defineContentScript({
  matches: ["*://*/*"],
  async main() {
    // Inject the script that will add the window.kastle object
    await injectScript("/injected.js", {
      keepInDom: true,
    });

    // Listen for messages from the source
    window.addEventListener("message", async (event: MessageEvent<unknown>) => {
      const message = event.data;

      if (!ApiRequest.validate(message)) {
        return;
      }

      // Filter out messages that are not to the background script from the browser
      if (message.target !== "background" && message.source !== "browser") {
        return;
      }

      message.host = window.location.host;

      // Send the message to the background script
      const response = await browser.runtime.sendMessage(message);

      // Send the response back to the source
      window.postMessage(response, "*");
    });
  },
});
