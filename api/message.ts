import { Buffer } from "buffer";
import { PaymentOutput, TransactionOptions } from "@/lib/wallet/interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export enum Action {
  CONNECT,
  GET_ACCOUNT,
  SIGN_AND_BROADCAST_TX,
}

export class TransactionPayload {
  constructor(
    public readonly networkId: string,
    public readonly outputs: PaymentOutput[],
    public readonly options?: TransactionOptions,
  ) {}

  static validate(data: unknown): data is TransactionPayload {
    return (
      typeof data === "object" &&
      !!data &&
      "networkId" in data &&
      "outputs" in data
    );
  }

  static fromBase64Url(base64Url: string): TransactionPayload {
    return JSON.parse(
      Buffer.from(
        base64Url
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "="),
        "base64",
      ).toString(),
    );
  }

  toBase64Url(): string {
    return Buffer.from(JSON.stringify(this))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
}

// ================================================================================================

export class ConnectPayload {
  constructor(
    public readonly name: string,
    public readonly networkId: NetworkType,
    public readonly icon?: string,
  ) {}

  static validate(data: unknown): data is ConnectPayload {
    return (
      typeof data === "object" &&
      !!data &&
      "name" in data &&
      "networkId" in data
    );
  }
}

// ================================================================================================

export class ApiRequest<T = unknown> {
  host?: string;
  source = "browser";
  target = "background";

  constructor(
    public readonly action: Action,
    public readonly id: string,
    public readonly payload?: T,
  ) {}

  static validate(data: unknown): data is ApiRequest {
    return (
      typeof data === "object" &&
      !!data &&
      "action" in data &&
      "id" in data &&
      "source" in data &&
      "target" in data
    );
  }
}

export class ApiResponse<T = unknown> {
  target = "browser";

  constructor(
    public readonly id: string,
    public readonly response: T,
    public readonly error?: string,
  ) {}

  static validate(data: unknown): data is ApiResponse {
    return (
      typeof data === "object" &&
      !!data &&
      "id" in data &&
      "response" in data &&
      "target" in data &&
      (!("error" in data) || typeof data.error === "string")
    );
  }
}

export class ApiExtensionResponse<T = unknown> {
  source = "extension";
  target = "background";

  constructor(
    public readonly id: string,
    public readonly response?: T,
    public readonly error?: string,
  ) {}

  static validate(data: unknown): data is ApiExtensionResponse {
    return (
      typeof data === "object" &&
      !!data &&
      "id" in data &&
      "source" in data &&
      "target" in data &&
      "response" in data &&
      (!("error" in data) || typeof data.error === "string")
    );
  }
}
