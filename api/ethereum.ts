import { ApiResponse, RpcRequest, ApiRequest, Action } from "@/api/message";
import { v4 as uuid } from "uuid";

export class EthereumBrowserAPI {
  private listerMap = new Map<
    (...args: unknown[]) => void,
    (event: MessageEvent<unknown>) => void
  >();

  request(request: RpcRequest) {
    const requestId = uuid();
    window.postMessage(
      new ApiRequest(Action.ETHEREUM_REQUEST, requestId, request),
      "*",
    );

    return this.receiveMessageWithTimeout(requestId);
  }

  on(eventName: string, listener: (...args: unknown[]) => void) {
    let onMessage;
    switch (eventName) {
      case "accountsChanged":
        onMessage = this.onAccountsChanged(listener);
        break;
      default:
        throw new Error(`Event ${eventName} is not supported`);
    }

    this.listerMap.set(listener, onMessage);
  }

  removeListener(listener: (...args: unknown[]) => void) {
    const callback = this.listerMap.get(listener);
    if (!callback) {
      return;
    }

    window.removeEventListener("message", callback);
    this.listerMap.delete(listener);
  }

  private onAccountsChanged(listener: (...args: unknown[]) => void) {
    const callback = this.createReceiveCallback<string[]>("accountsChanged");
    const onMessage = async (event: MessageEvent<unknown>) => {
      try {
        const result = callback(event);
        if (result === undefined) {
          return; // Skip if the result is empty, which means the message is not for this channel
        }

        listener(result);
      } catch (error) {
        window.removeEventListener("message", onMessage);
        throw error;
      }
    };

    window.addEventListener("message", onMessage);
    return onMessage;
  }

  private createReceiveCallback<T>(id: string) {
    return (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = event.data;
      if (!ApiResponse.validate(message)) {
        return;
      }

      if (message.id !== id || message.target !== "browser") {
        return;
      }

      // Reject if the message is an error
      if (message.error) {
        if (typeof message.error === "string") {
          throw new Error(message.error);
        } else {
          throw message.error;
        }
      }

      return message.response as T;
    };
  }

  private async receiveMessageWithTimeout<T>(
    id: string,
    timeout = 60_000, // 1 minute
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const callback = this.createReceiveCallback<T>(id);
      const onMessage = async (event: MessageEvent<unknown>) => {
        try {
          const result = callback(event);
          if (!result) {
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
