import { v4 as uuid } from "uuid";
import { Action, ApiRequest, ApiResponseSchema } from "@/api/message";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { EthereumBrowserAPI } from "./ethereum";
import { ConnectPayloadSchema } from "@/api/background/handlers/kaspa/connect";
import { SignTxPayloadSchema } from "@/api/background/handlers/kaspa/utils";
import { SignMessagePayloadSchema } from "@/api/background/handlers/kaspa/signMessage";
import { sendSompiPayloadSchema } from "./background/handlers/kaspa/sendSompi";

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

export type KastleEventMap = {
  // KasWare-compatible events
  accountsChanged: (accounts: string[]) => void;
  networkChanged: (network: string) => void;
  // KIP-style events
  "kas:account_changed": (address: string | null) => void;
  "kas:network_changed": (network: string | null) => void;
};

export type KastleEventType = keyof KastleEventMap;

export class KastleBrowserAPI {
  public readonly ethereum = new EthereumBrowserAPI();

  private readonly _eventListeners = new Map<
    KastleEventType,
    Set<(...args: any[]) => void>
  >();

  constructor() {
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) return;

      const result = ApiResponseSchema.safeParse(event.data);
      if (!result.success) return;

      const { id, response } = result.data;

      if (id === "kas:account_changed") {
        const address = response as string | null;
        this._emit("accountsChanged", address ? [address] : []);
        this._emit("kas:account_changed", address);
      } else if (id === "kas:network_changed") {
        this._emit("networkChanged", response as string);
        this._emit("kas:network_changed", response as string | null);
      }
    });
  }

  on<E extends KastleEventType>(event: E, handler: KastleEventMap[E]): this {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event)!.add(handler);
    return this;
  }

  removeListener<E extends KastleEventType>(
    event: E,
    handler: KastleEventMap[E],
  ): this {
    this._eventListeners.get(event)?.delete(handler);
    return this;
  }

  private _emit<E extends KastleEventType>(
    event: E,
    ...args: Parameters<KastleEventMap[E]>
  ): void {
    this._eventListeners.get(event)?.forEach((cb) => cb(...args));
  }

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
      "kas:connect": Action.CONNECT,
      "kas:get_account": Action.GET_ACCOUNT,
      "kas:get_network": Action.GET_NETWORK,
      "kas:sign_tx": Action.SIGN_TX,
      "kas:sign_and_broadcast_tx": Action.SIGN_AND_BROADCAST_TX,
      "kas:switch_network": Action.SWITCH_NETWORK,
      "kas:sign_message": Action.SIGN_MESSAGE,
      "kas:commit_reveal": Action.COMMIT_REVEAL,
      "kas:send_sompi": Action.SEND_SOMPI,
      "kas:get_balance": Action.GET_BALANCE,
      "kas:get_utxo_entries": Action.GET_UTXO_ENTRIES,
      "kas:build_transaction": Action.BUILD_TRANSACTION,
      "kas:get_version": Action.GET_VERSION,
    }[method];

    if (!action) {
      return;
    }

    const request = createApiRequest(action, requestId, args);
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async getVersion(): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(Action.GET_VERSION, requestId);
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

  async getNetwork(): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(Action.GET_NETWORK, requestId);
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async commitReveal(
    networkId: "mainnet" | "testnet-10",
    namespace: string,
    data: string,
    options?: { revealPriorityFee?: string },
  ): Promise<{ commitTxId: string; revealTxId: string }> {
    const requestId = uuid();
    const request = createApiRequest(Action.COMMIT_REVEAL, requestId, {
      networkId,
      namespace,
      data,
      options: options ?? {},
    });
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async getBalance(): Promise<{ balance: string }> {
    const requestId = uuid();
    const request = createApiRequest(Action.GET_BALANCE, requestId);
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async getUtxoEntries(): Promise<{
    entries: {
      address: string | undefined;
      outpoint: { transactionId: string; index: number };
      amount: string;
      scriptPublicKey: string;
      blockDaaScore: string;
      isCoinbase: boolean;
    }[];
  }> {
    const requestId = uuid();
    const request = createApiRequest(Action.GET_UTXO_ENTRIES, requestId);
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async buildTransaction(
    outputs: { address: string; amount: string }[],
    options?: { priorityFee?: string; payload?: string },
  ): Promise<{
    networkId: string;
    transactions: {
      txJson: string;
      id: string;
      feeAmount: string;
      changeAmount: string;
    }[];
  }> {
    const requestId = uuid();
    const request = createApiRequest(Action.BUILD_TRANSACTION, requestId, {
      outputs,
      priorityFee: options?.priorityFee ?? "0",
      payload: options?.payload,
    });
    window.postMessage(request, "*");

    return await this.receiveMessageWithTimeout(requestId);
  }

  async sendKaspa(
    toAddress: string,
    sompi: number,
    options?: { priorityFee?: number; payload?: string },
  ): Promise<string> {
    const requestId = uuid();
    const request = createApiRequest(
      Action.SEND_SOMPI,
      requestId,
      sendSompiPayloadSchema.parse({
        toAddress,
        sompi,
        options,
      }),
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
