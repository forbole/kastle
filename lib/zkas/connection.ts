import type { ZKasSelection } from "./selection";
import { sameZKasSelection } from "./selection";

export const ZKAS_CONNECTIONS_KEY = "local:zkas-connections";
export type ZKasConnections = Record<string, ZKasSelection[]>;

export function isAllowedZKasDappOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) return false;
    return url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

export function hasZKasConnection(
  connections: ZKasConnections | null,
  origin: string,
  selection: ZKasSelection,
): boolean {
  if (!isAllowedZKasDappOrigin(origin)) return false;
  return (connections?.[origin] ?? []).some((item) => sameZKasSelection(item, selection));
}

export function addZKasConnection(
  connections: ZKasConnections,
  origin: string,
  selection: ZKasSelection,
): ZKasConnections {
  if (!isAllowedZKasDappOrigin(origin)) throw new Error("Unsupported ZKas website origin");
  if (hasZKasConnection(connections, origin, selection)) return connections;
  return {
    ...connections,
    [origin]: [...(connections[origin] ?? []), selection],
  };
}

export class ZKasConnectionStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly adapter: {
    get(): Promise<ZKasConnections | null>;
    set(value: ZKasConnections): Promise<void>;
  };

  constructor(adapter: {
    get(): Promise<ZKasConnections | null>;
    set(value: ZKasConnections): Promise<void>;
  }) {
    this.adapter = adapter;
  }

  async list(): Promise<ZKasConnections> {
    await this.tail;
    return (await this.adapter.get()) ?? {};
  }

  private async mutate(change: (value: ZKasConnections) => ZKasConnections): Promise<void> {
    const operation = this.tail.then(async () => {
      const current = (await this.adapter.get()) ?? {};
      const next = change(current);
      if (next !== current) await this.adapter.set(next);
    });
    this.tail = operation.catch(() => undefined);
    await operation;
  }

  async add(origin: string, selection: ZKasSelection): Promise<void> {
    await this.mutate((current) => addZKasConnection(current, origin, selection));
  }

  async remove(origin: string): Promise<void> {
    if (!isAllowedZKasDappOrigin(origin)) throw new Error("Unsupported ZKas website origin");
    await this.mutate((current) => {
      if (!(origin in current)) return current;
      const next = { ...current };
      delete next[origin];
      return next;
    });
  }
}

export const zkasConnectionStore = new ZKasConnectionStore({
  get: () => storage.getItem<ZKasConnections>(ZKAS_CONNECTIONS_KEY),
  set: (value) => storage.setItem(ZKAS_CONNECTIONS_KEY, value),
});
