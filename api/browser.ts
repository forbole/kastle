import { v4 as uuid } from "uuid";
import {
  Action,
  ApiRequest,
  ApiResponse,
  ConnectPayload,
  SignMessagePayload,
  SignTxPayload,
} from "@/api/message";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

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

    const request = new ApiRequest(
      Action.CONNECT,
      requestId,
      new ConnectPayload(document.title, networkId as NetworkType, iconUrl),
    );
    window.postMessage(request, "*");

    return await this.receiveMessage(requestId);
  }

  async getAccount(): Promise<{ address: string; publicKey: string }> {
    const requestId = uuid();
    const request = new ApiRequest(Action.GET_ACCOUNT, requestId);
    window.postMessage(request, "*");

    return await this.receiveMessage(requestId);
  }

  async signAndBroadcastTx(
    networkId: "mainnet" | "testnet-10" | "testnet-11",
    txJson: string,
    scripts?: ScriptOption[],
  ): Promise<string> {
    const requestId = uuid();
    const request = new ApiRequest(
      Action.SIGN_AND_BROADCAST_TX,
      requestId,
      new SignTxPayload(networkId, txJson, scripts),
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
    const request = new ApiRequest(
      Action.SIGN_TX,
      requestId,
      new SignTxPayload(networkId, txJson, scripts),
    );
    window.postMessage(request, "*");

    return await this.receiveMessage(requestId);
  }

  async signMessage(message: string): Promise<string> {
    const requestId = uuid();
    const request = new ApiRequest(
      Action.SIGN_MESSAGE,
      requestId,
      new SignMessagePayload(message),
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
        if (!ApiResponse.validate(message)) {
          return;
        }

        if (message.id !== id || message.target !== "browser") {
          return;
        }

        window.removeEventListener("message", onMessage);

        // Reject if the message is an error
        if (message.error) {
          reject(new Error(message.error));
          return;
        }

        resolve(message.response as T);
      };

      window.addEventListener("message", onMessage);

      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Timeout"));
      }, timeout);
    });
  }
}
