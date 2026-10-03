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
import { sendSompiHandler } from "./handlers/kaspa/sendSompi";
import { getBalanceHandler } from "./handlers/kaspa/getBalance";
import { getUtxoEntriesHandler } from "./handlers/kaspa/getUtxoEntries";
import { buildTransactionHandler } from "./handlers/kaspa/buildTransaction";
import { getVersionHandler } from "./handlers/kaspa/getVersion";
import { compoundUtxosHandler } from "./handlers/kaspa/compoundUtxos";
import { zkasConnectHandler } from "./handlers/zkas/connect";
import { zkasGetAccountHandler } from "./handlers/zkas/get-account";
import { zkasGetBalanceHandler } from "./handlers/zkas/get-balance";
import { zkasSendHandler } from "./handlers/zkas/send";
import { isTrustedZKasPageRequest } from "./zkas-origin";
import { listenForZKasDappPaymentClosure } from "./zkas-dapp-payment";
import {
  listenForHistoryGrantClosure,
  zkasHistoryGrantHandler,
} from "./handlers/zkas/history-grant";
import {
  zkasDirectProfileHandler,
  zkasDirectViewHandler,
} from "./handlers/zkas/direct-profile";
import {
  listenForDirectActionClosure,
  zkasDirectActionStartHandler,
  zkasDirectActionCompleteHandler,
  zkasDirectActionStatusHandler,
  zkasDirectActionPendingHandler,
  zkasDirectActionResumeHandler,
} from "./handlers/zkas/direct-action";

export class BackgroundService {
  public listen(): void {
    listenForZKasDappPaymentClosure();
    listenForHistoryGrantClosure();
    listenForDirectActionClosure();
    browser.runtime.onMessage.addListener(
      (message: unknown, sender, sendResponse) => {
        const result = ApiRequestWithHostSchema.safeParse(message);
        if (!result.success) {
          return;
        }

        const parsedMessage = ApiRequestWithHostSchema.parse(message);

        if (
          [
            Action.ZKAS_CONNECT,
            Action.ZKAS_GET_ACCOUNT,
            Action.ZKAS_GET_BALANCE,
            Action.ZKAS_SEND,
            Action.ZKAS_HISTORY_GRANT,
            Action.MJ3_REQUEST_PROFILE,
            Action.MJ3_GET_DIRECT_VIEW,
            Action.MJ3_INVITE,
            Action.MJ3_DECIDE_INVITATION,
            Action.MJ3_SEND_DIRECT_MESSAGE,
            Action.MJ3_COMPLETE_DIRECT_ACTION,
            Action.MJ3_ACTION_STATUS,
            Action.MJ3_PENDING_DIRECT_ACTION,
            Action.MJ3_RESUME_DIRECT_ACTION,
          ].includes(parsedMessage.action) &&
          !isTrustedZKasPageRequest(
            parsedMessage.origin,
            sender,
            browser.runtime.id,
          )
        ) {
          sendResponse({
            id: parsedMessage.id,
            source: "background",
            target: "browser",
            response: null,
            error: "ZKas request origin did not match its tab",
          });
          return true;
        }

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
            await handler(tabId, parsedMessage, sendResponse, sender);
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

      [Action.SEND_SOMPI]: sendSompiHandler,
      [Action.GET_BALANCE]: getBalanceHandler,
      [Action.GET_UTXO_ENTRIES]: getUtxoEntriesHandler,
      [Action.BUILD_TRANSACTION]: buildTransactionHandler,
      [Action.GET_VERSION]: getVersionHandler,
      [Action.COMPOUND_UTXOS]: compoundUtxosHandler,
      [Action.ZKAS_CONNECT]: zkasConnectHandler,
      [Action.ZKAS_GET_ACCOUNT]: zkasGetAccountHandler,
      [Action.ZKAS_GET_BALANCE]: zkasGetBalanceHandler,
      [Action.ZKAS_SEND]: zkasSendHandler,
      [Action.ZKAS_HISTORY_GRANT]: zkasHistoryGrantHandler,
      [Action.MJ3_REQUEST_PROFILE]: zkasDirectProfileHandler,
      [Action.MJ3_GET_DIRECT_VIEW]: zkasDirectViewHandler,
      [Action.MJ3_INVITE]: zkasDirectActionStartHandler,
      [Action.MJ3_DECIDE_INVITATION]: zkasDirectActionStartHandler,
      [Action.MJ3_SEND_DIRECT_MESSAGE]: zkasDirectActionStartHandler,
      [Action.MJ3_COMPLETE_DIRECT_ACTION]: zkasDirectActionCompleteHandler,
      [Action.MJ3_ACTION_STATUS]: zkasDirectActionStatusHandler,
      [Action.MJ3_PENDING_DIRECT_ACTION]: zkasDirectActionPendingHandler,
      [Action.MJ3_RESUME_DIRECT_ACTION]: zkasDirectActionResumeHandler,
    };

    return handlers[action];
  }
}
