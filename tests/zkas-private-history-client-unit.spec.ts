import { expect, test } from "@playwright/test";
import {
  FixedHistoryClient,
  type PrivateHistoryLease,
} from "@/lib/zkas/private-history-client";

const after = "ab".repeat(32);
const raw = new TextEncoder().encode(
  '{"daa":"9007199254740993","blue":"18446744073709551615"}',
);

function lease(
  changes: Partial<PrivateHistoryLease> = {},
): PrivateHistoryLease {
  return {
    daemonUrl: "https://wallet.example.test",
    assertCurrent: async () => undefined,
    assertHostPermission: async () => undefined,
    readBearer: async () => undefined,
    ...changes,
  };
}

function ok(body: BodyInit = raw, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("fixed route returns byte-exact JSON with large decimal strings and no page credentials", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let checked = 0;
  let permitted = 0;
  const client = new FixedHistoryClient({
    lease: lease({
      daemonUrl: "http://127.0.0.1:8765",
      assertCurrent: async () => {
        checked++;
      },
      assertHostPermission: async () => {
        permitted++;
      },
    }),
    fetch: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return ok(raw);
    }) as typeof fetch,
  });
  const bytes = await client.getRawPage(after, 32);
  expect(Array.from(bytes)).toEqual(Array.from(raw));
  expect(new TextDecoder().decode(bytes)).toContain('"9007199254740993"');
  expect(new TextDecoder().decode(bytes)).toContain('"18446744073709551615"');
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(
    `http://127.0.0.1:8765/api/chain/shielded-history?after=${after}&limit=32`,
  );
  expect(calls[0].init).toMatchObject({
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  expect(calls[0].init.body).toBeUndefined();
  const headers = new Headers(calls[0].init.headers);
  expect(headers.has("Origin")).toBe(false);
  expect(headers.has("X-Wallet-Token")).toBe(false);
  expect(headers.has("Authorization")).toBe(false);
  expect(permitted).toBe(2);
  expect(checked).toBeGreaterThan(6);
});

test("only canonical configured daemon origins and exact query values are accepted", async () => {
  for (const daemonUrl of [
    "http://localhost:1",
    "http://localhost:65535",
    "https://wallet.example.test",
    "https://wallet.example.test:8443",
  ]) {
    expect(
      () => new FixedHistoryClient({ lease: lease({ daemonUrl }) }),
    ).not.toThrow();
  }
  for (const daemonUrl of [
    "http://example.test:8765",
    "http://127.0.0.2:8765",
    "http://[::1]:8765",
    "http://localhost",
    "http://localhost:80",
    "http://localhost:0",
    "http://localhost:08765",
    "http://localhost:65536",
    "http://localhost.evil.test:8765",
    "https://wallet.example.test/",
    "https://wallet.example.test/path",
    "https://wallet.example.test?q=1",
    "https://wallet.example.test#fragment",
    "https://user:secret@wallet.example.test",
  ]) {
    expect(
      () => new FixedHistoryClient({ lease: lease({ daemonUrl }) }),
    ).toThrow();
  }
  let calls = 0;
  const client = new FixedHistoryClient({
    lease: lease(),
    fetch: (async () => {
      calls++;
      return ok();
    }) as typeof fetch,
  });
  for (const cursor of ["AB".repeat(32), "aa", `${after}&url=elsewhere`]) {
    await expect(client.getRawPage(cursor, 1)).rejects.toThrow();
  }
  for (const limit of [0, 33, -1, 1.5, Number.NaN]) {
    await expect(client.getRawPage(after, limit)).rejects.toThrow();
  }
  expect(calls).toBe(0);
});

test("optional trusted bearer is bounded, exact and never echoed in errors", async () => {
  const token = "s".repeat(48);
  let authorization = "";
  const client = new FixedHistoryClient({
    lease: lease({ readBearer: async () => token }),
    fetch: (async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return ok();
    }) as typeof fetch,
  });
  await client.getRawPage(after, 1);
  expect(authorization).toBe(`Bearer ${token}`);
  for (const invalid of ["a", "a\nBearer x", "x".repeat(257), "x y", "x:\\y"]) {
    const bad = new FixedHistoryClient({
      lease: lease({ readBearer: async () => invalid }),
      fetch: (async () => {
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    await expect(bad.getRawPage(after, 1)).rejects.toThrow();
    try {
      await bad.getRawPage(after, 1);
    } catch (error) {
      if (invalid.length > 8) expect(String(error)).not.toContain(invalid);
    }
  }
});

test("context and permission fences stop a changed account before fetch and after read", async () => {
  let fetches = 0;
  let changed = false;
  const first = new FixedHistoryClient({
    lease: lease({
      assertHostPermission: async () => {
        changed = true;
      },
      assertCurrent: async () => {
        if (changed) throw new Error("private source changed");
      },
    }),
    fetch: (async () => {
      fetches++;
      return ok();
    }) as typeof fetch,
  });
  await expect(first.getRawPage(after, 1)).rejects.toThrow();
  expect(fetches).toBe(0);

  changed = false;
  const second = new FixedHistoryClient({
    lease: lease({
      assertCurrent: async () => {
        if (changed) throw new Error("private source changed");
      },
    }),
    fetch: (async () => {
      fetches++;
      changed = true;
      return ok();
    }) as typeof fetch,
  });
  await expect(second.getRawPage(after, 1)).rejects.toThrow();
  expect(fetches).toBe(1);

  changed = false;
  const third = new FixedHistoryClient({
    lease: lease({
      assertCurrent: async () => {
        if (changed) throw new Error("private source changed");
      },
    }),
    fetch: (async () =>
      ok(
        new ReadableStream({
          pull(controller) {
            changed = true;
            controller.enqueue(raw);
            controller.close();
          },
        }),
      )) as typeof fetch,
  });
  await expect(third.getRawPage(after, 1)).rejects.toThrow();
});

test("captured configured daemon survives no-op lease assertions across every awaited stage", async () => {
  for (const changedDuring of ["permission", "bearer", "read"] as const) {
    let requests = 0;
    const current = lease({
      assertHostPermission: async () => {
        if (changedDuring === "permission")
          Object.assign(current, { daemonUrl: "https://other.example.test" });
      },
      readBearer: async () => {
        if (changedDuring === "bearer")
          Object.assign(current, { daemonUrl: "https://other.example.test" });
        return undefined;
      },
    });
    const client = new FixedHistoryClient({
      lease: current,
      fetch: (async () => {
        requests++;
        if (changedDuring !== "read") return ok();
        return ok(
          new ReadableStream({
            pull(controller) {
              Object.assign(current, {
                daemonUrl: "https://other.example.test",
              });
              controller.enqueue(raw);
              controller.close();
            },
          }),
        );
      }) as typeof fetch,
    });
    await expect(client.getRawPage(after, 1)).rejects.toThrow();
    expect(requests).toBe(changedDuring === "read" ? 1 : 0);
    await expect(client.getRawPage(after, 1)).rejects.toThrow();
    expect(requests).toBe(changedDuring === "read" ? 1 : 0);
  }
});

test("header and streamed response caps reject every partial result", async () => {
  const max = 6 * 1024 * 1024;
  const large = new Uint8Array(max);
  const exact = new FixedHistoryClient({
    lease: lease(),
    fetch: (async () =>
      ok(large, { "Content-Length": String(max) })) as typeof fetch,
  });
  expect((await exact.getRawPage(after, 1)).length).toBe(max);
  for (const length of [
    String(max + 1),
    "-1",
    "01",
    "1e9",
    "999999999999999999999",
  ]) {
    const bad = new FixedHistoryClient({
      lease: lease(),
      fetch: (async () =>
        ok(raw, { "Content-Length": length })) as typeof fetch,
    });
    await expect(bad.getRawPage(after, 1)).rejects.toThrow();
  }
  const overflow = new FixedHistoryClient({
    lease: lease(),
    fetch: (async () =>
      ok(new Uint8Array(max + 1), { "Content-Length": "1" })) as typeof fetch,
  });
  await expect(overflow.getRawPage(after, 1)).rejects.toThrow();
});

test("many tiny chunks remain bounded and malformed HTTP responses fail closed", async () => {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index++ === 10_000) controller.close();
      else controller.enqueue(Uint8Array.of(0x78));
    },
  });
  const client = new FixedHistoryClient({
    lease: lease(),
    fetch: (async () => ok(stream)) as typeof fetch,
  });
  expect((await client.getRawPage(after, 1)).length).toBe(10_000);
  for (const response of [
    new Response(null, { status: 204 }),
    new Response(raw, { status: 500 }),
    new Response(raw, { headers: { "Content-Type": "text/plain" } }),
    new Response(null, { headers: { "Content-Type": "application/json" } }),
    new Response(new Uint8Array(), {
      headers: { "Content-Type": "application/json" },
    }),
  ]) {
    const failed = new FixedHistoryClient({
      lease: lease(),
      fetch: (async () => response) as typeof fetch,
    });
    await expect(failed.getRawPage(after, 1)).rejects.toThrow();
  }
});

test("one deadline covers hung private fences, fetch and stream reads; cancellation cannot hang", async () => {
  const never = new Promise<never>(() => undefined);
  let fetches = 0;
  for (const changes of [
    { assertCurrent: () => never },
    { assertHostPermission: () => never },
    { readBearer: () => never },
  ]) {
    const client = new FixedHistoryClient({
      lease: lease(changes),
      deadlineMs: 15,
    });
    await expect(client.getRawPage(after, 1)).rejects.toThrow(/deadline/i);
  }
  const hungFetch = new FixedHistoryClient({
    lease: lease(),
    deadlineMs: 15,
    fetch: (async () => {
      fetches++;
      return never;
    }) as typeof fetch,
  });
  await expect(hungFetch.getRawPage(after, 1)).rejects.toThrow(/deadline/i);
  await expect(hungFetch.getRawPage(after, 1)).rejects.toThrow();
  expect(fetches).toBe(1);
  const hungRead = new FixedHistoryClient({
    lease: lease(),
    deadlineMs: 15,
    fetch: (async () =>
      ok(
        new ReadableStream({
          pull: () => never,
          cancel: () => never,
        }),
      )) as typeof fetch,
  });
  await expect(hungRead.getRawPage(after, 1)).rejects.toThrow(/deadline/i);
});
