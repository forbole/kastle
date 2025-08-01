import { v4 as uuid } from "uuid";
import { Action, ApiRequest, ApiResponseSchema } from "@/api/message";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { EthereumBrowserAPI } from "./ethereum";
import { ConnectPayloadSchema } from "@/api/background/handlers/kaspa/connect";
import { SignTxPayloadSchema } from "@/api/background/handlers/kaspa/utils";
import { SignMessagePayloadSchema } from "@/api/background/handlers/kaspa/signMessage";

function createApiRequest(
  action: Action,
  requestId: string,
  payload?: unknown,
): ApiRequest {
  return {
    action,
    id: requestId,
    source: "browser",
    target: "background",
    payload,
  };
}

export class KastleBrowserAPI {
  public readonly ethereum = new EthereumBrowserAPI();

  constructor() {}

  async connect(): Promise<boolean> {
    const requestId = uuid();

    const iconElement =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]');

    let iconUrl: string | undefined;
    if (iconElement instanceof HTMLLinkElement) {
      iconUrl = iconElement.href;
    }

    const request = createApiRequest(
      Action.CONNECT,
      requestId,
      ConnectPayloadSchema.parse({
        name: document.title,
        icon: iconUrl,
      }),
    );

    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async disconnect(): Promise<void> {}

  async request(method: string, args?: unknown): Promise<any> {
    const requestId = uuid();
    const action = {
      "kas:get_account": Action.GET_ACCOUNT,
      "kas:get_network": Action.GET_NETWORK,
      "kas:sign_tx": Action.SIGN_TX,
      "kas:sign_and_broadcast_tx": Action.SIGN_AND_BROADCAST_TX,
      "kas:switch_network": Action.SWITCH_NETWORK,
      "kas:sign_message": Action.SIGN_MESSAGE,
      "kas:commit_reveal": Action.COMMIT_REVEAL,
    }[method];

    if (!action) {
      return;
    }

    const request = createApiRequest(action, requestId, args);
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async getAccount(): Promise<{ address: string; publicKey: string }> {
    const requestId = uuid();
    const request = createApiRequest(Action.GET_ACCOUNT, requestId);
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async signAndBroadcastTx(
    networkId: "mainnet" | "testnet-10",
    txJson: string,
    scripts?: ScriptOption[],
  ): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(
      Action.SIGN_AND_BROADCAST_TX,
      requestId,
      SignTxPayloadSchema.parse({
        networkId,
        txJson,
        scripts,
      }),
    );
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async signTx(
    networkId: "mainnet" | "testnet-10",
    txJson: string,
    scripts?: ScriptOption[],
  ): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(
      Action.SIGN_TX,
      requestId,
      SignTxPayloadSchema.parse({
        networkId,
        txJson,
        scripts,
      }),
    );
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async signMessage(message: string): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(
      Action.SIGN_MESSAGE,
      requestId,
      SignMessagePayloadSchema.parse(message),
    );
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async switchNetwork(networkId: "mainnet" | "testnet-10"): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(
      Action.SWITCH_NETWORK,
      requestId,
      networkId,
    );
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  private createReceiveCallback<T>(id: string) {
    return (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = event.data;
      const result = ApiResponseSchema.safeParse(message);
      if (!result.success) {
        return;
      }

      const parsedMessage = ApiResponseSchema.parse(message);
      if (parsedMessage.id !== id) {
        return;
      }

      // Reject if the message is an error
      if (parsedMessage.error) {
        if (typeof parsedMessage.error === "string") {
          throw new Error(parsedMessage.error);
        } else {
          throw parsedMessage.error;
        }
      }

      return parsedMessage.response as T;
    };
  }

  private async receiveMessageWithTimeout<T>(
    id: string,
    timeout = 180_000, // 3 minute
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const callback = this.createReceiveCallback<T>(id);
      const onMessage = async (event: MessageEvent<unknown>) => {
        try {
          const result = callback(event);
          if (result === undefined) {
            return; // Skip if the result is empty, which means the message is not for this channel
          }

          resolve(result);
        } catch (error) {
          window.removeEventListener("message", onMessage);
          reject(error);
        }
      };

      window.addEventListener("message", onMessage);

      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timeout"));
      }, timeout);
    });
  }
}
