import { connectHandler } from "@/api/background/handlers/connect";
import { getAccountHandler } from "@/api/background/handlers/getAccount";
import { signAndBroadcastTxHandler } from "@/api/background/handlers/signAndBroadcastTx";
import { signTxHandler } from "@/api/background/handlers/signTx";
import {
  Action,
  ApiRequestWithHostSchema,
  ApiResponseSchema,
} from "@/api/message";

export class BackgroundService {
  public listen(): void {
    browser.runtime.onMessage.addListener(
      (message: unknown, sender, sendResponse) => {
        const result = ApiRequestWithHostSchema.safeParse(message);
        if (!result.success) {
          return;
        }

        const parsedMessage = ApiRequestWithHostSchema.parse(message);

        const handler = this.getHandler(parsedMessage.action);

        if (!handler) {
          sendResponse(
            ApiResponseSchema.parse({
              id: parsedMessage.id,
              target: "browser",
              error: "Invalid action",
            }),
          );

          // Set return true to enable sendResponse callback
          return true;
        }

        browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (tab?.id) {
            handler(tab.id, parsedMessage, sendResponse).catch((error) => {
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
      [Action.SIGN_TX]: signTxHandler,
    };

    return handlers[action];
  }
}
