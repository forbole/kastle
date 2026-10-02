import { z } from "zod";
import type { ZKasBatchIntent, ZKasSignedBytes } from "./batch-journal";

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const outputSchema = z
  .object({
    recipient: z.string().min(1).max(120),
    amount: decimal,
    memo: z.string().regex(/^[0-9a-f]{1024}$/),
  })
  .strict();
const envelopeSchema = z
  .object({
    format: z.literal("zkas-prepared-payment-multi"),
    version: z.literal(3),
    networkDomain: hex32,
    account: z
      .string()
      .regex(/^zkas:[a-z0-9]+$/)
      .max(120),
    outputs: z.array(outputSchema).min(1).max(8),
    fee: decimal,
    txContext: z
      .string()
      .regex(/^[0-9a-f]+$/)
      .max(512),
    bundle: z
      .string()
      .regex(/^[0-9a-f]+$/)
      .max(1_000_000),
    disclosure: z
      .array(
        z.object({
          spendValue: decimal,
          outValue: decimal,
          outRecipient: z.string().max(86),
          outRseed: z.string().max(64),
          rcv: z.string().max(64),
        }),
      )
      .max(32),
    spendAuth: z
      .array(
        z.object({
          actionIndex: z.number().int().nonnegative().max(31),
          alpha: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .max(32),
    checksum: hex32,
  })
  .strict();

const prepareSchema = z
  .object({
    status: z.enum(["in_progress", "prepared", "failed", "finalized"]),
    logicalId: hex32,
    session: z
      .string()
      .regex(/^[0-9a-f]{48}$/)
      .optional(),
    preparedPayment: envelopeSchema.optional(),
  })
  .strict();
const grantSchema = z
  .object({
    capability: hex32,
    logicalId: hex32,
    expiresAtUnix: z.number().int().positive().safe(),
  })
  .strict();
const finalSchema = z
  .object({
    status: z.literal("finalized"),
    logicalId: hex32,
    transactionHex: z
      .string()
      .regex(/^[0-9a-f]+$/)
      .max(1_000_000),
    txid: hex32,
    sha256: hex32,
  })
  .strict();
const sendStatusSchema = z
  .object({
    status: z.enum([
      "finalized_unsent",
      "unknown",
      "mempool",
      "included",
      "settled",
      "conflicted",
    ]),
    logicalId: hex32,
    txid: hex32,
    sha256: hex32,
    includedBlock: hex32.optional(),
    includedDaa: z.number().int().nonnegative().safe().optional(),
  })
  .strict();

export type ZKasPreparedBatch = z.infer<typeof prepareSchema>;
export type ZKasBatchSendStatus = z.infer<typeof sendStatusSchema>;

function daemonBase(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid configured ZKas daemon URL");
  }
  return url.origin;
}

function assertOrigin(value: string): void {
  if (!/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(value) || value.length > 200)
    throw new Error("Invalid batch application origin");
}

function hexBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0)
    throw new Error("Finalized transaction hex is not byte aligned");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function validateSignedBytes(
  value: z.infer<typeof finalSchema>,
): Promise<ZKasSignedBytes> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", hexBytes(value.transactionHex)),
  );
  const actual = Array.from(hash, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== value.sha256)
    throw new Error("Finalized transaction digest mismatch");
  return {
    transactionHex: value.transactionHex,
    txid: value.txid,
    sha256: value.sha256,
  };
}

async function readBoundedJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  if (!response.ok)
    throw new Error(`ZKas daemon returned HTTP ${response.status}`);
  const length = response.headers.get("Content-Length");
  if (length && Number(length) > limit)
    throw new Error("ZKas daemon response is too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty ZKas daemon response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("ZKas daemon response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

// Used in the application's own browser context. The browser supplies its
// real Origin header; this client never receives a wallet credential.
export class ZKasBatchCapabilityClient {
  private readonly base: string;
  private readonly origin: string;
  private readonly currentOrigin: () => string;
  private readonly fetcher: typeof fetch;

  constructor(config: {
    baseUrl: string;
    origin: string;
    currentOrigin?: () => string;
    fetch?: typeof fetch;
  }) {
    this.base = daemonBase(config.baseUrl);
    assertOrigin(config.origin);
    this.origin = config.origin;
    this.currentOrigin =
      config.currentOrigin ?? (() => globalThis.location?.origin ?? "");
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async prepare(
    capability: string,
    logicalId: string,
  ): Promise<ZKasPreparedBatch> {
    if (this.currentOrigin() !== this.origin)
      throw new Error("Application origin changed during batch preparation");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 360_000);
    try {
      const response = await this.fetcher(
        `${this.base}/api/wallet/prepare-many`,
        {
          method: "POST",
          headers: { Authorization: `Batch ${hex32.parse(capability)}` },
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        },
      );
      const prepared = prepareSchema.parse(
        await readBoundedJson(response, 8192),
      );
      if (
        prepared.logicalId !== hex32.parse(logicalId) ||
        prepared.session ||
        prepared.preparedPayment
      ) {
        throw new Error(
          "Capability preparation exposed wallet data or changed payment",
        );
      }
      return prepared;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ZKasBatchClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor(config: {
    baseUrl: string;
    token: string;
    fetch?: typeof fetch;
  }) {
    this.base = daemonBase(config.baseUrl);
    if (!/^[0-9a-f]{32}$/.test(config.token))
      throw new Error("Invalid wallet token");
    this.token = config.token;
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      timeoutMs?: number;
    } = {},
  ): Promise<unknown> {
    if (!path.startsWith("/api/wallet/") || path.includes("//"))
      throw new Error("Invalid wallet route");
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30_000,
    );
    try {
      const headers = new Headers();
      headers.set("X-Wallet-Token", this.token);
      if (options.body !== undefined)
        headers.set("Content-Type", "application/json");
      const response = await this.fetcher(`${this.base}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      return await readBoundedJson(response, 2_000_000);
    } finally {
      clearTimeout(timer);
    }
  }

  async grant(
    intent: ZKasBatchIntent,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }> {
    assertOrigin(intent.origin);
    const response = grantSchema.parse(
      await this.request("/api/wallet/prepare-many/capability", {
        method: "POST",
        body: {
          origin: intent.origin,
          account: intent.account,
          genesis: intent.genesis,
          logicalId: intent.logicalId,
          outputs: intent.outputs,
          maxFeeSompi: intent.maxFeeSompi,
        },
      }),
    );
    if (response.logicalId !== intent.logicalId)
      throw new Error("Batch capability changed logical payment");
    return response;
  }

  async prepared(logicalId: string): Promise<ZKasPreparedBatch> {
    const response = prepareSchema.parse(
      await this.request(
        `/api/wallet/prepare-many?logicalId=${hex32.parse(logicalId)}`,
      ),
    );
    if (
      response.logicalId !== logicalId ||
      (response.status === "prepared" &&
        (!response.session || !response.preparedPayment))
    )
      throw new Error("Incomplete prepared batch");
    return response;
  }

  async finalize(
    intent: ZKasBatchIntent,
    session: string,
    signatures: { actionIndex: number; signatureHex: string }[],
  ): Promise<ZKasSignedBytes> {
    if (
      !/^[0-9a-f]{48}$/.test(session) ||
      !signatures.length ||
      signatures.length > 32 ||
      signatures.some(
        (sig) =>
          !Number.isSafeInteger(sig.actionIndex) ||
          sig.actionIndex < 0 ||
          sig.actionIndex > 31 ||
          !/^[0-9a-f]{128}$/.test(sig.signatureHex),
      )
    )
      throw new Error("Invalid batch signer response");
    const response = finalSchema.parse(
      await this.request("/api/wallet/finalize-many", {
        method: "POST",
        body: {
          account: intent.account,
          genesis: intent.genesis,
          logicalId: intent.logicalId,
          session,
          signatures,
        },
        timeoutMs: 360_000,
      }),
    );
    if (response.logicalId !== intent.logicalId)
      throw new Error("Finalization changed logical payment");
    return validateSignedBytes(response);
  }

  async finalizedJournal(intent: ZKasBatchIntent): Promise<ZKasSignedBytes> {
    const query = new URLSearchParams({
      account: intent.account,
      genesis: intent.genesis,
      logicalId: intent.logicalId,
    });
    const response = finalSchema.parse(
      await this.request(`/api/wallet/finalize-many/journal?${query}`),
    );
    if (response.logicalId !== intent.logicalId)
      throw new Error("Finalization recovery changed logical payment");
    return validateSignedBytes(response);
  }

  async submit(
    intent: ZKasBatchIntent,
    signed: ZKasSignedBytes,
  ): Promise<ZKasBatchSendStatus> {
    const response = sendStatusSchema.parse(
      await this.request("/api/wallet/submit-many", {
        method: "POST",
        body: {
          account: intent.account,
          genesis: intent.genesis,
          logicalId: intent.logicalId,
          txid: signed.txid,
          sha256: signed.sha256,
        },
        timeoutMs: 90_000,
      }),
    );
    if (
      response.logicalId !== intent.logicalId ||
      response.txid !== signed.txid ||
      response.sha256 !== signed.sha256
    )
      throw new Error("Submission status changed signed transaction identity");
    return response;
  }

  async status(intent: ZKasBatchIntent): Promise<ZKasBatchSendStatus> {
    const query = new URLSearchParams({
      account: intent.account,
      genesis: intent.genesis,
      logicalId: intent.logicalId,
    });
    const response = sendStatusSchema.parse(
      await this.request(`/api/wallet/submit-many/status?${query}`),
    );
    if (response.logicalId !== intent.logicalId)
      throw new Error("Status changed logical payment");
    return response;
  }
}
