import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "@playwright/test";
import {
  FixedHistoryIndexClient,
  type PrivateHistoryIndexLease,
} from "@/lib/zkas/private-history-index-client";

const id = "ab".repeat(32);
const block = "cd".repeat(32);
const raw = new TextEncoder().encode('{"daa":9007199254740993,"memo":"dummy"}');

test("the bounded status cursor is only an untrusted fixed-origin hint", async () => {
  const requests: string[] = [];
  const client = new FixedHistoryIndexClient({
    lease: lease(),
    fetch: async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          genesis: block,
          cursor: { hash: id, daa: "9007199254740993" },
        }),
      );
    },
  });
  expect(await client.getCursorHint()).toEqual({ genesis: block, cursor: id });
  expect(requests).toEqual(["https://index.example.test/v1/status"]);
  client.close();
  await expect(client.getCursorHint()).rejects.toThrow();
});

test("a stalled status body remains inside the fixed deadline", async () => {
  const stalled = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => undefined),
  });
  const client = new FixedHistoryIndexClient({
    lease: lease(),
    deadlineMs: 20,
    fetch: async () => new Response(stalled),
  });
  await expect(client.getCursorHint()).rejects.toThrow("deadline");
  client.close();
});

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function envelope(rpc = raw, bundle = new Uint8Array([1])): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      txid: id,
      blockHash: block,
      daa: 42,
      rpcTransaction: b64(rpc),
      shieldedBundle: b64(bundle),
    }),
  );
}

function lease(
  indexUrl = "https://index.example.test",
  changes: Partial<PrivateHistoryIndexLease> = {},
): PrivateHistoryIndexLease {
  return {
    indexUrl,
    assertCurrent: async () => undefined,
    assertHostPermission: async () => undefined,
    ...changes,
  };
}

function ok(
  bytes: Uint8Array | ReadableStream<Uint8Array> = envelope(),
  headers: HeadersInit = {},
): Response {
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("actual disposable HTTP fetch uses one fixed route and returns byte-exact raw RPC JSON", async () => {
  const requests: Array<{
    url: string | undefined;
    authorization: string | undefined;
    cookie: string | undefined;
  }> = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(envelope());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture address missing");
    const client = new FixedHistoryIndexClient({
      lease: lease(`http://127.0.0.1:${address.port}`),
    });
    const result = await client.getRawTransaction(id);
    expect(Array.from(result)).toEqual(Array.from(raw));
    expect(new TextDecoder().decode(result)).toContain("9007199254740993");
    expect(requests).toEqual([
      { url: `/v1/tx/${id}`, authorization: undefined, cookie: undefined },
    ]);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("only a canonical configured origin and native-requested lowercase ID are accepted", async () => {
  for (const origin of [
    "https://index.example.test",
    "https://index.example.test:8443",
    "http://localhost:8767",
    "http://127.0.0.1:1",
  ]) {
    expect(
      () => new FixedHistoryIndexClient({ lease: lease(origin) }),
    ).not.toThrow();
  }
  for (const origin of [
    "http://index.example.test:8767",
    "http://127.0.0.2:8767",
    "http://localhost",
    "http://localhost:80",
    "http://localhost:0",
    "http://localhost:65536",
    "https://index.example.test/",
    "https://index.example.test/path",
    "https://index.example.test?q=1",
    "https://user:password@index.example.test",
  ]) {
    expect(
      () => new FixedHistoryIndexClient({ lease: lease(origin) }),
    ).toThrow();
  }
  let fetches = 0;
  const client = new FixedHistoryIndexClient({
    lease: lease(),
    fetch: (async () => {
      fetches++;
      return ok();
    }) as typeof fetch,
  });
  for (const malformed of [
    "AB".repeat(32),
    "ab",
    `${id}?url=evil`,
    `${id}/../status`,
  ])
    await expect(client.getRawTransaction(malformed)).rejects.toThrow();
  expect(fetches).toBe(0);
});

test("untrusted hints and malformed base64 cannot create a raw body", async () => {
  for (const replacement of [
    "YQ=",
    "YQ==",
    "YR",
    "Y",
    "Y+",
    "Y/",
    "YQ\n",
    "_",
  ]) {
    const body = JSON.stringify({
      txid: id,
      blockHash: block,
      daa: 1,
      rpcTransaction: replacement,
      shieldedBundle: "AQ",
    });
    const client = new FixedHistoryIndexClient({
      lease: lease(),
      fetch: (async () => ok(new TextEncoder().encode(body))) as typeof fetch,
    });
    await expect(client.getRawTransaction(id)).rejects.toThrow();
  }
  for (const fields of [
    { txid: "ef".repeat(32) },
    { blockHash: "wrong" },
    { rpcTransaction: "" },
    { shieldedBundle: "AQ==" },
    { surprise: 1 },
  ]) {
    const value = {
      txid: id,
      blockHash: block,
      daa: 1,
      rpcTransaction: b64(raw),
      shieldedBundle: "AQ",
      ...fields,
    };
    const client = new FixedHistoryIndexClient({
      lease: lease(),
      fetch: (async () =>
        ok(new TextEncoder().encode(JSON.stringify(value)))) as typeof fetch,
    });
    await expect(client.getRawTransaction(id)).rejects.toThrow();
  }
});

test("exact raw and bundle byte limits accept boundary and reject plus one", async () => {
  const atRaw = new Uint8Array(2_000_000).fill(7);
  const atBundle = new Uint8Array(500_000).fill(9);
  for (const [rpc, bundle, permitted] of [
    [atRaw, new Uint8Array(1), true],
    [new Uint8Array(1), atBundle, true],
    [new Uint8Array(2_000_001), new Uint8Array(1), false],
    [new Uint8Array(1), new Uint8Array(500_001), false],
  ] as const) {
    const client = new FixedHistoryIndexClient({
      lease: lease(),
      fetch: (async () => ok(envelope(rpc, bundle))) as typeof fetch,
    });
    if (permitted)
      expect((await client.getRawTransaction(id)).length).toBe(rpc.length);
    else await expect(client.getRawTransaction(id)).rejects.toThrow();
  }
});

test("whole envelope cap applies to declared and streaming lengths without partial results", async () => {
  const tooLarge = new Uint8Array(4 * 1024 * 1024 + 1).fill(32);
  const declared = new FixedHistoryIndexClient({
    lease: lease(),
    fetch: (async () =>
      ok(envelope(), {
        "Content-Length": String(tooLarge.length),
      })) as typeof fetch,
  });
  await expect(declared.getRawTransaction(id)).rejects.toThrow();
  const streamed = new FixedHistoryIndexClient({
    lease: lease(),
    fetch: (async () =>
      ok(
        new ReadableStream({
          start(controller) {
            controller.enqueue(tooLarge);
            controller.close();
          },
        }),
      )) as typeof fetch,
  });
  await expect(streamed.getRawTransaction(id)).rejects.toThrow();
});

test("permission, source, close, and deadline changes stop a pending stream", async () => {
  let permitted = true;
  let source = "https://index.example.test";
  const currentLease = lease(source, {
    assertCurrent: async () => {
      if (source !== "https://index.example.test")
        throw new Error("source changed");
    },
    assertHostPermission: async () => {
      if (!permitted) throw new Error("permission lost");
    },
  });
  const client = new FixedHistoryIndexClient({
    lease: currentLease,
    fetch: (async () => {
      permitted = false;
      return ok();
    }) as typeof fetch,
  });
  await expect(client.getRawTransaction(id)).rejects.toThrow();

  permitted = true;
  const other = new FixedHistoryIndexClient({
    lease: currentLease,
    fetch: (async () => {
      source = "https://different.example.test";
      return ok();
    }) as typeof fetch,
  });
  await expect(other.getRawTransaction(id)).rejects.toThrow();

  permitted = true;
  const streamed = new FixedHistoryIndexClient({
    lease: currentLease,
    fetch: (async () =>
      ok(
        new ReadableStream({
          start(controller) {
            controller.enqueue(envelope().subarray(0, 8));
            setTimeout(() => {
              permitted = false;
              controller.enqueue(envelope().subarray(8));
              controller.close();
            }, 5);
          },
        }),
      )) as typeof fetch,
  });
  source = "https://index.example.test";
  await expect(streamed.getRawTransaction(id)).rejects.toThrow();

  const stalled = new FixedHistoryIndexClient({
    lease: lease(),
    deadlineMs: 30,
    fetch: (async () =>
      ok(
        new ReadableStream({
          start(controller) {
            controller.enqueue(envelope().subarray(0, 8));
          },
        }),
      )) as typeof fetch,
  });
  await expect(stalled.getRawTransaction(id)).rejects.toThrow();

  let begin!: () => void;
  const pending = new FixedHistoryIndexClient({
    lease: lease(),
    fetch: (async () => {
      begin();
      return new Promise<Response>(() => undefined);
    }) as typeof fetch,
  });
  const begun = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const request = pending.getRawTransaction(id);
  await begun;
  await expect(pending.getRawTransaction(id)).rejects.toThrow();
  pending.close();
  await expect(request).rejects.toThrow();
  await expect(pending.getRawTransaction(id)).rejects.toThrow();
});

test("HTTP errors, redirects, non-JSON, malformed UTF-8 and truncated JSON fail closed", async () => {
  for (const response of [
    new Response("missing", { status: 404 }),
    new Response("denied", { status: 401 }),
    new Response("{}", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }),
    ok(new Uint8Array([0xff])),
    ok(new TextEncoder().encode('{"txid":')),
  ]) {
    const client = new FixedHistoryIndexClient({
      lease: lease(),
      fetch: (async () => response) as typeof fetch,
    });
    await expect(client.getRawTransaction(id)).rejects.toThrow();
  }
});

test("a changed account during the initial host-permission check prevents the fixed GET", async () => {
  let current = true;
  let fetches = 0;
  const client = new FixedHistoryIndexClient({
    lease: lease(undefined, {
      assertCurrent: async () => {
        if (!current) throw new Error("account changed");
      },
      assertHostPermission: async () => {
        current = false;
        await Promise.resolve();
      },
    }),
    fetch: (async () => {
      fetches++;
      return ok();
    }) as typeof fetch,
  });
  await expect(client.getRawTransaction(id)).rejects.toThrow();
  expect(fetches).toBe(0);
});

test("a changed account during the final host-permission check withholds raw bytes", async () => {
  let current = true;
  let permissions = 0;
  const client = new FixedHistoryIndexClient({
    lease: lease(undefined, {
      assertCurrent: async () => {
        if (!current) throw new Error("account changed");
      },
      assertHostPermission: async () => {
        if (++permissions === 8) {
          current = false;
          await Promise.resolve();
        }
      },
    }),
    fetch: (async () => ok()) as typeof fetch,
  });
  const result = await client.getRawTransaction(id).then(
    (bytes) => ({ published: true, bytes }),
    () => ({ published: false }),
  );
  expect(permissions).toBe(8);
  expect(result.published).toBe(false);
});

test("unchanged permission wait returns only exact native-requested raw bytes", async () => {
  let permissionEntered!: () => void;
  let permissionRelease!: () => void;
  const entered = new Promise<void>((resolve) => {
    permissionEntered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    permissionRelease = resolve;
  });
  let first = true;
  const urls: string[] = [];
  const client = new FixedHistoryIndexClient({
    lease: lease("https://index.example.test", {
      assertCurrent: async () => undefined,
      assertHostPermission: async () => {
        if (first) {
          first = false;
          permissionEntered();
          await blocked;
        }
      },
    }),
    fetch: (async (input) => {
      urls.push(String(input));
      return ok();
    }) as typeof fetch,
  });
  const request = client.getRawTransaction(id);
  await entered;
  expect(urls).toEqual([]);
  permissionRelease();
  expect(new TextDecoder().decode(await request)).toBe(
    '{"daa":9007199254740993,"memo":"dummy"}',
  );
  expect(urls).toEqual([`https://index.example.test/v1/tx/${id}`]);
});
