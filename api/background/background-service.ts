import { connectHandler } from "@/api/background/handlers/kaspa/connect";
import { getAccountHandler } from "@/api/background/handlers/kaspa/getAccount";
import { signAndBroadcastTxHandler } from "@/api/background/handlers/kaspa/signAndBroadcastTx";
import { signTxHandler } from "@/api/background/handlers/kaspa/signTx";
import {
  Action,
  ApiRequestWithHostSchema,
  ApiResponseSchema,
} from "@/api/message";
import { getNetwork } from "@/api/background/handlers/kaspa/get-network";
import { ethereumRequestHandler } from "@/api/background/handlers/ethereum/request";
import { signMessageHandler } from "@/api/background/handlers/kaspa/signMessage";
import { switchNetworkHandler } from "@/api/background/handlers/kaspa/switchNetwork";
import { commitRevealHandler } from "./handlers/kaspa/commitReveal";

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
              source: "background",
              target: "browser",
              error: "Invalid action",
            }),
          );

          // Set return true to enable sendResponse callback
          return true;
        }

        const tabId = sender.tab?.id;
        if (tabId) {
          const handleMessage = async () => {
            await handler(tabId, parsedMessage, sendResponse);
          };

          handleMessage().catch((error) => {
            sendResponse(
              ApiResponseSchema.parse({
                id: parsedMessage.id,
                source: "background",
                target: "browser",
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            );
          });
        } else {
          sendResponse(
            ApiResponseSchema.parse({
              id: parsedMessage.id,
              source: "background",
              target: "browser",
              error: "No tab ID found",
            }),
          );
        }

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
      [Action.GET_NETWORK]: getNetwork,
      [Action.ETHEREUM_REQUEST]: ethereumRequestHandler,
      [Action.SIGN_MESSAGE]: signMessageHandler,
      [Action.SWITCH_NETWORK]: switchNetworkHandler,
      [Action.COMMIT_REVEAL]: commitRevealHandler,
    };

    return handlers[action];
  }
}
