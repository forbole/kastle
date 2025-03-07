import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export enum Action {
  CONNECT,
  GET_ACCOUNT,
  SIGN_AND_BROADCAST_TX,
  SIGN_TX,
}

export class SignTxPayload {
  constructor(
    public readonly networkId: string,
    public readonly txJson: string,
    public readonly scripts?: ScriptOption[],
  ) {}

  static validate(data: unknown): data is SignTxPayload {
    return (
      typeof data === "object" &&
      !!data &&
      "networkId" in data &&
      "txJson" in data
    );
  }

  static fromUriString(uriComponent: string): SignAndBroadcastTxPayload {
    const parsed = JSON.parse(decodeURIComponent(uriComponent));
    return new SignAndBroadcastTxPayload(
      parsed.networkId,
      parsed.txJson,
      parsed.scripts,
    );
  }

  toUriString(): string {
    return encodeURIComponent(JSON.stringify(this));
  }
}

export class SignAndBroadcastTxPayload {
  constructor(
    public readonly networkId: string,
    public readonly txJson: string,
    public readonly scripts?: ScriptOption[],
  ) {}

  static validate(data: unknown): data is SignAndBroadcastTxPayload {
    return (
      typeof data === "object" &&
      !!data &&
      "networkId" in data &&
      "txJson" in data
    );
  }

  static fromUriString(uriComponent: string): SignAndBroadcastTxPayload {
    const parsed = JSON.parse(decodeURIComponent(uriComponent));
    return new SignAndBroadcastTxPayload(
      parsed.networkId,
      parsed.txJson,
      parsed.scripts,
    );
  }

  toUriString(): string {
    return encodeURIComponent(JSON.stringify(this));
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
