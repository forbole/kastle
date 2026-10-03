/** Fixed, extension-private transport for untrusted indexed transaction bodies. */

const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
const MAX_RPC_BYTES = 2_000_000;
const MAX_BUNDLE_BYTES = 500_000;
const MAX_DEADLINE_MS = 25_000;
const ID = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** A future privileged factory supplies this lease; the interface is not a grant. */
export type PrivateHistoryIndexLease = {
  readonly indexUrl: string;
  assertCurrent(): Promise<void>;
  assertHostPermission(): Promise<void>;
};

function canonicalOrigin(value: string): string {
  if (typeof value !== "string" || value.length > 256)
    throw new Error("Invalid configured history index");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid configured history index");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const port = Number(url.port);
  if (
    value !== url.origin ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        loopback &&
        /^[1-9][0-9]{0,4}$/.test(url.port) &&
        port <= 65535 &&
        port !== 80)
    )
  )
    throw new Error("Invalid configured history index");
  return value;
}

function contentLength(value: string | null): void {
  if (value === null) return;
  if (!/^[1-9][0-9]{0,6}$/.test(value) || Number(value) > MAX_ENVELOPE_BYTES)
    throw new Error("Invalid index response length");
}

function decodeCanonical(
  value: unknown,
  max: number,
  allowEmpty: boolean,
): Uint8Array {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > Math.ceil(max / 3) * 4 ||
    !BASE64URL.test(value) ||
    value.length % 4 === 1
  )
    throw new Error("Invalid indexed transaction encoding");
  let binary: string;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  } catch {
    throw new Error("Invalid indexed transaction encoding");
  }
  if (
    binary.length > max ||
    btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "") !== value
  )
    throw new Error("Invalid indexed transaction encoding");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodedRpc(envelope: Uint8Array, requested: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(envelope),
    );
  } catch {
    throw new Error("Invalid index response");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Invalid index response");
  const fields = parsed as Record<string, unknown>;
  const names = Object.keys(fields).sort();
  if (
    names.join("|") !== "blockHash|daa|rpcTransaction|shieldedBundle|txid" ||
    typeof fields.txid !== "string" ||
    !ID.test(fields.txid) ||
    fields.txid !== requested ||
    typeof fields.blockHash !== "string" ||
    !ID.test(fields.blockHash) ||
    typeof fields.daa !== "number" ||
    !Number.isFinite(fields.daa) ||
    fields.daa < 0 ||
    !Number.isInteger(fields.daa)
  )
    throw new Error("Invalid index response");
  // The cache's DAA and other hints confer no chain authority. Never use their JS values.
  const raw = decodeCanonical(fields.rpcTransaction, MAX_RPC_BYTES, false);
  decodeCanonical(fields.shieldedBundle, MAX_BUNDLE_BYTES, true);
  return raw;
}

export class FixedHistoryIndexClient {
  private readonly base: string;
  private readonly lease: PrivateHistoryIndexLease;
  private readonly fetcher: typeof fetch;
  private readonly deadlineMs: number;
  private active?: { abort(): void };
  private stopped = false;

  constructor(config: {
    lease: PrivateHistoryIndexLease;
    fetch?: typeof fetch;
    /** May shorten the production deadline for tests, never extend it. */
    deadlineMs?: number;
  }) {
    this.base = canonicalOrigin(config.lease.indexUrl);
    this.lease = config.lease;
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
    const deadline = config.deadlineMs ?? MAX_DEADLINE_MS;
    if (
      !Number.isSafeInteger(deadline) ||
      deadline < 1 ||
      deadline > MAX_DEADLINE_MS
    )
      throw new Error("Invalid private index deadline");
    this.deadlineMs = deadline;
  }

  close(): void {
    this.stopped = true;
    this.active?.abort();
  }

  /** Untrusted cursor hint only. The configured daemon must witness selection. */
  async getCursorHint(): Promise<{ genesis: string; cursor: string }> {
    if (this.stopped || this.active)
      throw new Error("Private index context unavailable");
    const controller = new AbortController();
    this.active = controller;
    let expired = false;
    let timeout: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = () => {
        expired = true;
        controller.abort();
        reject(new Error("Private index hint deadline exceeded"));
      };
    });
    const timer = setTimeout(() => timeout?.(), this.deadlineMs);
    const bounded = <T>(operation: () => Promise<T>) =>
      Promise.race([operation(), deadline]);
    try {
      const checked = async () => {
        if (this.lease.indexUrl !== this.base || this.stopped || expired)
          throw new Error("Private index context changed");
        await bounded(() => this.lease.assertCurrent());
        if (this.lease.indexUrl !== this.base || this.stopped || expired)
          throw new Error("Private index context changed");
      };
      await checked();
      await bounded(() => this.lease.assertHostPermission());
      await checked();
      const response = await bounded(() =>
        this.fetcher(`${this.base}/v1/status`, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        }),
      );
      await checked();
      if (
        response.status !== 200 ||
        !response.body ||
        Number(response.headers.get("content-length") ?? 0) > 65_536
      )
        throw new Error("Private index hint unavailable");
      const reader = response.body.getReader();
      const bytes = new Uint8Array(65_536);
      let length = 0;
      try {
        for (;;) {
          const part = await bounded(() => reader.read());
          if (part.done) break;
          if (length + part.value.length > bytes.length)
            throw new Error("Private index hint exceeds limit");
          bytes.set(part.value, length);
          length += part.value.length;
          await checked();
        }
      } finally {
        reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, length),
        ),
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Private index hint unavailable");
      const row = value as Record<string, unknown>;
      if (
        typeof row.genesis !== "string" ||
        !ID.test(row.genesis) ||
        !row.cursor ||
        typeof row.cursor !== "object" ||
        Array.isArray(row.cursor)
      )
        throw new Error("Private index hint unavailable");
      const cursor = (row.cursor as Record<string, unknown>).hash;
      if (typeof cursor !== "string" || !ID.test(cursor))
        throw new Error("Private index hint unavailable");
      await checked();
      return { genesis: row.genesis, cursor };
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.active = undefined;
    }
  }

  async getRawTransaction(txid: string): Promise<Uint8Array> {
    if (!ID.test(txid)) throw new Error("Invalid indexed transaction ID");
    if (this.stopped) throw new Error("Private index context must be reopened");
    if (this.active) throw new Error("Private index request already active");
    const controller = new AbortController();
    const waiters = new Set<() => void>();
    let expired = false;
    const abort = () => {
      controller.abort();
      for (const waiter of waiters) waiter();
      waiters.clear();
    };
    const active = { abort };
    this.active = active;
    const deadlineAt = performance.now() + this.deadlineMs;
    const timer = setTimeout(() => {
      expired = true;
      abort();
    }, this.deadlineMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const bounded = <T>(operation: () => T | Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (this.stopped || expired || performance.now() >= deadlineAt) {
          reject(new Error("Private index deadline or context changed"));
          return;
        }
        const cancelled = () =>
          reject(new Error("Private index deadline or context changed"));
        waiters.add(cancelled);
        Promise.resolve()
          .then(operation)
          .then(
            (value) => {
              waiters.delete(cancelled);
              resolve(value);
            },
            (cause: unknown) => {
              waiters.delete(cancelled);
              reject(cause);
            },
          );
      });
    const assertLive = () => {
      if (
        this.stopped ||
        expired ||
        performance.now() >= deadlineAt ||
        this.lease.indexUrl !== this.base
      )
        throw new Error("Private index context changed");
    };
    const fence = async () => {
      assertLive();
      await bounded(() => this.lease.assertCurrent());
      assertLive();
      await bounded(() => this.lease.assertHostPermission());
      assertLive();
      await bounded(() => this.lease.assertCurrent());
      assertLive();
    };
    try {
      await fence();
      const url = `${this.base}/v1/tx/${txid}`;
      const response = await bounded(() =>
        this.fetcher(url, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        }),
      );
      await fence();
      if (
        response.status !== 200 ||
        response.redirected ||
        (response.url && response.url !== url) ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          response.headers.get("Content-Type") ?? "",
        )
      )
        throw new Error("Invalid index response");
      contentLength(response.headers.get("Content-Length"));
      reader = response.body?.getReader();
      if (!reader) throw new Error("Empty index response");
      const buffer = new Uint8Array(MAX_ENVELOPE_BYTES);
      let used = 0;
      while (true) {
        await fence();
        const part = await bounded(() => reader!.read());
        await fence();
        if (part.done) break;
        if (
          !(part.value instanceof Uint8Array) ||
          part.value.byteLength > MAX_ENVELOPE_BYTES - used
        )
          throw new Error("Index response exceeds byte limit");
        buffer.set(part.value, used);
        used += part.value.byteLength;
      }
      await fence();
      if (used === 0) throw new Error("Empty index response");
      const raw = decodedRpc(buffer.subarray(0, used), txid);
      await fence();
      return raw;
    } catch {
      this.stopped = true;
      throw new Error(
        expired
          ? "Private index deadline exceeded"
          : "Private history index unavailable",
      );
    } finally {
      controller.abort();
      if (reader) {
        try {
          void Promise.resolve(reader.cancel()).catch(() => undefined);
        } catch {
          /* no delay */
        }
        try {
          reader.releaseLock();
        } catch {
          /* pending read may retain the lock */
        }
      }
      clearTimeout(timer);
      waiters.clear();
      if (this.active === active) this.active = undefined;
    }
  }
}
