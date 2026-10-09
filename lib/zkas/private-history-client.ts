/** Fixed, extension-private transport for a configured daemon's public chain page. */

const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const MAX_DEADLINE_MS = 25_000;
const CURSOR = /^[0-9a-f]{64}$/;
const BEARER = /^[A-Za-z0-9._~+/-]{16,256}={0,2}$/;

/** A trusted private factory must implement these checks; this type does not grant access. */
export type PrivateHistoryLease = {
  /** Captured from Kastle's configured daemon, never from the requesting page. */
  readonly daemonUrl: string;
  /** Recheck selected account/address, network/genesis, grant/origin and unlock/source generation. */
  assertCurrent(): Promise<void>;
  assertHostPermission(): Promise<void>;
  /** Optional global transport bearer, distinct from X-Wallet-Token. */
  readBearer(): Promise<string | undefined>;
};

function canonicalBase(value: string): string {
  if (typeof value !== "string" || value.length > 256) {
    throw new Error("Invalid configured history daemon");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid configured history daemon");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const httpPort = Number(url.port);
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
        httpPort <= 65535 &&
        httpPort !== 80)
    )
  ) {
    throw new Error("Invalid configured history daemon");
  }
  return value;
}

function validContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (value.length > 7 || !/^[1-9][0-9]{0,6}$/.test(value)) {
    throw new Error("Invalid history response length");
  }
  const length = Number(value);
  if (length > MAX_PAGE_BYTES) {
    throw new Error("History response exceeds byte limit");
  }
  return length;
}

export class FixedHistoryClient {
  private readonly base: string;
  private readonly lease: PrivateHistoryLease;
  private readonly fetcher: typeof fetch;
  private readonly deadlineMs: number;
  private inFlight = false;
  private stopped = false;

  constructor(config: {
    lease: PrivateHistoryLease;
    fetch?: typeof fetch;
    /** May shorten the production deadline for tests, never extend it. */
    deadlineMs?: number;
  }) {
    this.base = canonicalBase(config.lease.daemonUrl);
    this.lease = config.lease;
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
    const deadline = config.deadlineMs ?? MAX_DEADLINE_MS;
    if (
      !Number.isSafeInteger(deadline) ||
      deadline < 1 ||
      deadline > MAX_DEADLINE_MS
    ) {
      throw new Error("Invalid private history deadline");
    }
    this.deadlineMs = deadline;
  }

  async getRawPage(after: string, limit: number): Promise<Uint8Array> {
    if (
      !CURSOR.test(after) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 32
    ) {
      throw new Error("Invalid private history cursor");
    }
    if (this.stopped)
      throw new Error("Private history context must be reopened");
    if (this.inFlight)
      throw new Error("Private history request already active");
    this.inFlight = true;
    const controller = new AbortController();
    let expired = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const deadlineAt = performance.now() + this.deadlineMs;
    // Remove each settled waiter. Racing every tiny chunk against one unresolved
    // promise would retain millions of deadline callbacks until the timer fires.
    const waiters = new Set<() => void>();
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
      for (const reject of waiters) reject();
      waiters.clear();
    }, this.deadlineMs);
    const bounded = <T>(operation: () => T | Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (expired || performance.now() >= deadlineAt) {
          expired = true;
          controller.abort();
          reject(new Error("Private history deadline exceeded"));
          return;
        }
        const timedOut = () =>
          reject(new Error("Private history deadline exceeded"));
        waiters.add(timedOut);
        Promise.resolve()
          .then(operation)
          .then(
            (value) => {
              waiters.delete(timedOut);
              resolve(value);
            },
            (error: unknown) => {
              waiters.delete(timedOut);
              reject(error);
            },
          );
      });
    // Assertions themselves are bounded. Recursively fencing an assertion would never terminate.
    const assertCurrent = async () => {
      if (this.lease.daemonUrl !== this.base)
        throw new Error("Configured history daemon changed");
      await bounded(() => this.lease.assertCurrent());
      if (this.lease.daemonUrl !== this.base)
        throw new Error("Configured history daemon changed");
    };
    try {
      await assertCurrent();
      await bounded(() => this.lease.assertHostPermission());
      await assertCurrent();
      const bearer = await bounded(() => this.lease.readBearer());
      await assertCurrent();
      if (
        bearer !== undefined &&
        (bearer.length > 256 || !BEARER.test(bearer))
      ) {
        throw new Error("Invalid private history transport credential");
      }
      const url = `${this.base}/api/chain/shielded-history?after=${after}&limit=${limit}`;
      const headers = new Headers();
      if (bearer !== undefined)
        headers.set("Authorization", `Bearer ${bearer}`);
      const response = await bounded(() =>
        this.fetcher(url, {
          method: "GET",
          headers,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        }),
      );
      await assertCurrent();
      if (
        response.status !== 200 ||
        response.redirected ||
        (response.url && response.url !== url) ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          response.headers.get("Content-Type") ?? "",
        )
      ) {
        throw new Error("Invalid private history response");
      }
      validContentLength(response.headers.get("Content-Length"));
      reader = response.body?.getReader();
      if (!reader) throw new Error("Empty private history response");
      // One contiguous backing store bounds retained memory even for millions of tiny chunks.
      const buffer = new Uint8Array(MAX_PAGE_BYTES);
      let used = 0;
      while (true) {
        await assertCurrent();
        const part = await bounded(() => reader!.read());
        await assertCurrent();
        if (part.done) break;
        if (
          !(part.value instanceof Uint8Array) ||
          part.value.byteLength > MAX_PAGE_BYTES - used
        ) {
          throw new Error("History response exceeds byte limit");
        }
        buffer.set(part.value, used);
        used += part.value.byteLength;
      }
      await assertCurrent();
      await bounded(() => this.lease.assertHostPermission());
      await assertCurrent();
      if (used === 0) throw new Error("Empty private history response");
      if (expired || performance.now() >= deadlineAt)
        throw new Error("Private history deadline exceeded");
      return buffer.slice(0, used);
    } catch {
      // A failed read cannot be continued under the old private lease or request cursor.
      this.stopped = true;
      throw new Error(
        expired
          ? "Private history deadline exceeded"
          : "Private history unavailable",
      );
    } finally {
      controller.abort();
      if (reader) {
        try {
          void Promise.resolve(reader.cancel()).catch(() => undefined);
        } catch {
          // Cancellation must never delay the caller's failure or success.
        }
        try {
          reader.releaseLock();
        } catch {
          // A pending read may retain the lock until the transport settles.
        }
      }
      clearTimeout(timer);
      waiters.clear();
      this.inFlight = false;
    }
  }
}
