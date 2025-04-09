import { connectHandler } from "@/api/background/handlers/connect";
import { getAccountHandler } from "@/api/background/handlers/getAccount";
import { signAndBroadcastTxHandler } from "@/api/background/handlers/signAndBroadcastTx";
import { signTxHandler } from "@/api/background/handlers/signTx";
import {
  Action,
  ApiRequestWithHostSchema,
  ApiResponseSchema,
} from "@/api/message";
import { getWalletAddress } from "@/api/background/handlers/get-wallet-address.ts";
import { getNetwork } from "@/api/background/handlers/get-network.ts";
import { switchNetwork } from "@/api/background/handlers/switch-network.ts";
import { sendKaspa } from "@/api/background/handlers/send-kaspa.ts";
import { signPskt } from "@/api/background/handlers/sign-pskt.ts";
import { doCommitReveal } from "@/api/background/handlers/do-commit-reveal.ts";
import { doRevealOnly } from "@/api/background/handlers/do-reveal-only.ts";
import { getPublicKey } from "@/api/background/handlers/get-public-key.ts";
import { signMessage } from "@/api/background/handlers/sign-message.ts";
import { compoundUtxo } from "@/api/background/handlers/compound-utxo.ts";

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
      [Action.GET_WALLET_ADDRESS]: getWalletAddress,
      [Action.GET_PUBLIC_KEY]: getPublicKey,
      [Action.GET_NETWORK]: getNetwork,
      [Action.SWITCH_NETWORK]: switchNetwork,
      [Action.SEND_KASPA]: sendKaspa,
      [Action.SIGN_MESSAGE]: signMessage,
      [Action.SIGN_PSKT]: signPskt,
      [Action.DO_COMMIT_REVEAL]: doCommitReveal,
      [Action.DO_REVEAL_ONLY]: doRevealOnly,
      [Action.COMPOUND_UTXO]: compoundUtxo,
    };

    return handlers[action];
  }
}
