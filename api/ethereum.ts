import {
  RpcRequest,
  Action,
  ApiResponseSchema,
  ApiRequest,
  RPC_ERRORS,
} from "@/api/message";
import { v4 as uuid } from "uuid";

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

export class EthereumBrowserAPI {
  private listenerMap = new Map<
    (...args: unknown[]) => void,
    (event: MessageEvent<unknown>) => void
  >();

  request(request: RpcRequest) {
    const requestId = uuid();
    const apiRequest = createApiRequest(
      Action.ETHEREUM_REQUEST,
      requestId,
      request,
    );

    return this.postAndReceive(apiRequest);
  }

  on(eventName: string, listener: (...args: unknown[]) => void) {
    let onMessage;
    switch (eventName) {
      case "accountsChanged":
        onMessage = this.onAccountsChanged(listener);
        break;
      case "chainChanged":
        onMessage = this.onChainChanged(listener);
      default:
        return;
    }

    this.listenerMap.set(listener, onMessage);
  }

  removeListener(listener: (...args: unknown[]) => void) {
    const callback = this.listenerMap.get(listener);
    if (!callback) {
      return;
    }

    window.removeEventListener("message", callback);
    this.listenerMap.delete(listener);
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

  private onChainChanged(listener: (...args: unknown[]) => void) {
    const callback = this.createReceiveCallback<string>("chainChanged");
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
  }

  private async postAndReceive<T>(request: ApiRequest) {
    const receiveCallback = this.receiveMessageWithTimeout<T>(request.id);
    window.postMessage(request, "*");
    return receiveCallback;
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
    timeout = 60_000, // 1 minute
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
        reject(RPC_ERRORS.TIMEOUT);
      }, timeout);
    });
  }
}
