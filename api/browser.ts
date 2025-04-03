import { v4 as uuid } from "uuid";
import {
  Action,
  ApiRequest,
  ApiResponseSchema,
  ConnectPayloadSchema,
  SignTxPayloadSchema,
} from "@/api/message";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";

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
  constructor() {}

  async connect(
    networkId: "mainnet" | "testnet-10" | "testnet-11",
  ): Promise<boolean> {
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
        networkId,
        name: document.title,
        icon: iconUrl,
      }),
    );

    window.postMessage(request, "*");

    return await this.receiveMessage(requestId);
  }

  async getAccount(): Promise<{ address: string; publicKey: string }> {
    const requestId = uuid();
    const request = createApiRequest(Action.GET_ACCOUNT, requestId);
    window.postMessage(request, "*");

    return await this.receiveMessage(requestId);
  }

  async signAndBroadcastTx(
    networkId: "mainnet" | "testnet-10" | "testnet-11",
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

    return await this.receiveMessage(requestId);
  }

  async signTx(
    networkId: "mainnet" | "testnet-10" | "testnet-11",
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

    return await this.receiveMessage(requestId);
  }

  private async receiveMessage<T>(
    id: string,
    timeout = 60_000, // 1 minute
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onMessage = async (event: MessageEvent<unknown>) => {
        const message = event.data;

        const result = ApiResponseSchema.safeParse(message);
        if (!result.success) {
          return;
        }

        const parsedMessage = ApiResponseSchema.parse(message);
        if (parsedMessage.id !== id) {
          return;
        }

        window.removeEventListener("message", onMessage);

        // Reject if the message is an error
        if (parsedMessage.error) {
          reject(new Error(parsedMessage.error));
          return;
        }

        resolve(parsedMessage.response as T);
      };

      window.addEventListener("message", onMessage);

      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timeout"));
      }, timeout);
    });
  }
}
