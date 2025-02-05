import { connectHandler } from "@/api/background/handlers/connect";
import { getAccountHandler } from "@/api/background/handlers/getAccount";
import { signAndBroadcastTxHandler } from "@/api/background/handlers/signAndBroadcastTx";
import { Action, ApiRequest, ApiResponse } from "@/api/message";

export class BackgroundService {
  public listen(): void {
    browser.runtime.onMessage.addListener(
      (message: unknown, sender, sendResponse) => {
        if (!ApiRequest.validate(message)) {
          return;
        }

        if (message.source !== "browser") {
          return;
        }

        const handler = this.getHandler(message.action);

        if (!handler) {
          sendResponse(
            new ApiResponse(message.id, undefined, "Invalid action"),
          );

          // Set return true to enable sendResponse callback
          return true;
        }

        browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (tab?.id) {
            handler(tab.id, message, sendResponse).catch((error) => {
              console.error("Unresolved error:", error);
            });
          }
        });

        // Set return true to enable sendResponse callback
        return true;
      },
    );
  }

  private getHandler(action: Action) {
    const handlers = {
      [Action.CONNECT]: connectHandler,
      [Action.GET_ACCOUNT]: getAccountHandler,
      [Action.SIGN_AND_BROADCAST_TX]: signAndBroadcastTxHandler,
    };

    return handlers[action];
  }
}
