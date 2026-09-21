import { z } from "zod";
import { formatZkasAmount, MAX_ZKAS_SOMPI, parseZkasSompi } from "./amount";
import { validateZKasMemo } from "./memo";

export type ZKasNetwork = "mainnet" | "testnet";

export interface ZKasSigner {
  address(): string;
  fullViewingKeyHex(): Promise<string>;
  verifyAndSign(input: {
    network: ZKasNetwork;
    recipient: string;
    amountSompi: bigint;
    maxFeeSompi: bigint;
    memo?: string;
    bundleHex: string;
    disclosure: unknown;
    spendAuth: unknown;
  }): Promise<{ index: number; sig: string }[]>;
}

const statusSchema = z.object({
  has_wallet: z.boolean(),
  address: z.string().nullable(),
  network: z.string(),
  node_connected: z.boolean(),
  daa_score: z.number().int().nonnegative().safe(),
  synced: z.boolean(),
  missing_history: z.boolean().optional(),
});
const balanceSchema = z.object({ balance_sompi: z.string() });
const watchSchema = z.object({ address: z.string() });
const prepareSchema = z.object({
  session: z.string().min(1),
  bundle_hex: z.string().regex(/^(?:[0-9a-fA-F]{2})+$/),
  amount_sompi_exact: z.string(),
  fee_sompi_exact: z.string(),
  remaining_sompi_exact: z.string().optional(),
  disclosure: z.array(z.unknown()),
  spend_auth: z.array(z.unknown()),
});
const submitSchema = z.object({
  txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
  amount_sompi_exact: z.string(),
  fee_sompi_exact: z.string(),
});
function exactHistorySompi(
  approximate: number | undefined,
  exact: string | undefined,
  label: string,
): string {
  if (exact !== undefined) {
    const sompi = parseZkasSompi(exact, label);
    if (
      approximate !== undefined &&
      Number.isSafeInteger(approximate) &&
      BigInt(approximate) !== sompi
    ) {
      throw new Error(`ZKas history ${label} disagrees with its exact value`);
    }
    return sompi.toString();
  }
  if (approximate === undefined || !Number.isSafeInteger(approximate)) {
    throw new Error(`ZKas history ${label} is not exact`);
  }
  return parseZkasSompi(approximate.toString(), label).toString();
}

const historyRowSchema = z
  .object({
    kind: z.enum(["coinbase", "received", "sent"]),
    txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
    amountSompi: z.number().int().nonnegative().optional(),
    amountSompiExact: z.string().optional(),
    amountKind: z.enum(["netOutflow", "paid"]).optional(),
    feeSompi: z.number().int().nonnegative().optional(),
    feeSompiExact: z.string().optional(),
    feeKnown: z.boolean().optional(),
    timestamp: z.number().int().nonnegative().safe(),
    daaScore: z.number().int().nonnegative().safe().optional(),
    recipient: z.string().max(256).nullable().optional(),
    memo: z.string().max(512).nullable().optional(),
  })
  .transform((row) => ({
    ...row,
    amountSompiExact: exactHistorySompi(
      row.amountSompi,
      row.amountSompiExact,
      "amount",
    ),
    feeSompiExact: exactHistorySompi(row.feeSompi, row.feeSompiExact, "fee"),
  }));
const historySchema = z.object({
  recoverableHistory: z.boolean(),
  total: z.number().int().nonnegative().safe(),
  rows: z.array(historyRowSchema).max(30),
  pendingOutgoing: z
    .array(
      z.object({
        txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
        amountSompi: z.number().int().nonnegative(),
      }),
    )
    .max(30)
    .transform((rows) =>
      rows.map((row) => ({
        ...row,
        amountSompiExact: Number.isSafeInteger(row.amountSompi)
          ? row.amountSompi.toString()
          : undefined,
      })),
    )
    .optional(),
});

export type ZKasState = {
  address: string;
  balanceSompi: bigint;
  synced: boolean;
  missingHistory: boolean;
};
export type ZKasHistory = z.infer<typeof historySchema>;

export class ZKasSubmissionUncertainError extends Error {
  readonly txid?: string;

  constructor(txid?: string) {
    super(
      "ZKas payment outcome is uncertain. Check wallet history before trying again.",
    );
    this.name = "ZKasSubmissionUncertainError";
    this.txid = txid;
  }
}

export class ZKasPreSubmitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ZKasPreSubmitError";
  }
}

function validatedBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("ZKas daemon URL must use HTTPS, except on localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("ZKas daemon URL cannot contain credentials or query data");
  }
  return url.toString().replace(/\/+$/, "");
}

export function getZKasDaemonOriginPattern(value: string): string {
  const url = new URL(validatedBaseUrl(value));
  if (url.hostname === "[::1]") {
    throw new Error("Use localhost or 127.0.0.1 for a local ZKas daemon");
  }
  return `${url.protocol}//${url.hostname}/*`;
}

export class ZKasClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly network: ZKasNetwork;
  private readonly fetcher: typeof fetch;
  private readonly guard?: () => Promise<void>;

  constructor(config: {
    baseUrl: string;
    token?: string;
    network: ZKasNetwork;
    fetch?: typeof fetch;
    guard?: () => Promise<void>;
  }) {
    this.baseUrl = validatedBaseUrl(config.baseUrl);
    if (config.token !== undefined && !/^[0-9a-fA-F]{32}$/.test(config.token)) {
      throw new Error("Invalid ZKas wallet token");
    }
    this.token = config.token;
    this.network = config.network;
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.guard = config.guard;
  }

  private async request(
    path: string,
    body?: unknown,
    beforeFetch?: () => Promise<void>,
  ): Promise<unknown> {
    try {
      await this.guard?.();
      await beforeFetch?.();
      if (beforeFetch) await this.guard?.();
    } catch (cause) {
      throw new ZKasPreSubmitError(cause);
    }
    const timeoutMs =
      path === "/api/wallet/prepare"
        ? 360_000
        : path === "/api/wallet/submit"
          ? 90_000
          : 30_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(this.token ? { "X-Wallet-Token": this.token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ZKas daemon returned HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async status(): Promise<z.infer<typeof statusSchema>> {
    const status = statusSchema.parse(await this.request("/api/status"));
    if (status.network !== this.network) {
      throw new Error(
        "ZKas daemon network does not match the selected network",
      );
    }
    return status;
  }

  async currentBirthday(): Promise<number> {
    return (await this.status()).daa_score;
  }

  async register(
    fvkHex: string,
    expectedAddress: string,
    birthday: number,
  ): Promise<z.infer<typeof statusSchema>> {
    if (!/^[0-9a-fA-F]{192}$/.test(fvkHex)) {
      throw new Error("Invalid ZKas viewing key");
    }
    if (!Number.isSafeInteger(birthday) || birthday < 0) {
      throw new Error("Invalid ZKas wallet birthday");
    }
    if (!this.token) throw new Error("ZKas wallet token is required");
    const status = await this.status();
    const effectiveBirthday = birthday > status.daa_score ? 0 : birthday;
    let address = status.address;
    if (!status.has_wallet) {
      const watch = watchSchema.parse(
        await this.request("/api/wallet/watch", {
          fvk_hex: fvkHex,
          birthday: effectiveBirthday,
          recoverable_history: true,
        }),
      );
      address = watch.address;
    }
    const expectedPrefix = this.network === "mainnet" ? "zkas:" : "zkastest:";
    if (
      !expectedAddress.startsWith(expectedPrefix) ||
      address !== expectedAddress
    ) {
      throw new Error("ZKas daemon address does not match the local account");
    }
    return status;
  }

  async state(fvkHex: string, expectedAddress: string): Promise<ZKasState> {
    const status = await this.register(fvkHex, expectedAddress, 0);
    const balance = balanceSchema.parse(
      await this.request("/api/wallet/balance"),
    );
    return {
      address: expectedAddress,
      balanceSompi: parseZkasSompi(balance.balance_sompi, "balance"),
      synced: status.node_connected && status.synced,
      missingHistory: status.missing_history === true,
    };
  }

  async history(): Promise<ZKasHistory> {
    return historySchema.parse(
      await this.request("/api/wallet/history?limit=30"),
    );
  }

  async send(input: {
    signer: ZKasSigner;
    to: string;
    amountSompi: bigint;
    maxFeeSompi: bigint;
    memo?: string;
    beforeSubmit?: () => Promise<void>;
  }): Promise<{ txid: string; daemonReportedFeeSompi: bigint }> {
    if (this.network !== "mainnet") {
      throw new Error("The pinned ZKas signer cannot approve testnet payments");
    }
    const { signer, amountSompi, maxFeeSompi } = input;
    const memo = validateZKasMemo(input.memo);
    if (
      amountSompi <= 0n ||
      amountSompi > MAX_ZKAS_SOMPI ||
      maxFeeSompi <= 0n ||
      maxFeeSompi > MAX_ZKAS_SOMPI
    ) {
      throw new Error("ZKas amount or fee is out of range");
    }
    const to = input.to.trim();
    const expectedPrefix = this.network === "mainnet" ? "zkas:" : "zkastest:";
    if (!to.startsWith(expectedPrefix)) {
      throw new Error("ZKas recipient network does not match");
    }
    const fvk = await signer.fullViewingKeyHex();
    const state = await this.state(fvk, signer.address());
    if (!state.synced) throw new Error("ZKas daemon is not synced");
    if (state.missingHistory) {
      throw new Error("ZKas daemon is missing wallet history");
    }
    if (state.balanceSompi < amountSompi) {
      throw new Error("Insufficient ZKas balance");
    }
    const prepared = prepareSchema.parse(
      await this.request("/api/wallet/prepare", {
        fvk_hex: fvk,
        to,
        amount_sompi: amountSompi.toString(),
        // walletd treats this field as a caller-selected fee floor. Request its
        // byte-priced relay minimum; the user's value remains a maximum that
        // Kastle verifies against the prepared bundle below.
        fee: "0",
        ...(memo === undefined ? {} : { memo }),
        allow_partial: false,
      }),
    );
    const preparedAmount = parseZkasSompi(
      prepared.amount_sompi_exact,
      "prepared amount",
    );
    const preparedFee = parseZkasSompi(
      prepared.fee_sompi_exact,
      "prepared fee",
    );
    const remaining = parseZkasSompi(
      prepared.remaining_sompi_exact ?? "0",
      "remaining amount",
    );
    if (remaining !== 0n) throw new Error("ZKas payment would be partial");
    if (preparedAmount !== amountSompi) {
      throw new Error("ZKas daemon changed the payment amount");
    }
    if (preparedFee > maxFeeSompi) {
      throw new Error(
        `ZKas daemon proposes a fee of ${formatZkasAmount(preparedFee)} ZKAS, above your ${formatZkasAmount(maxFeeSompi)} ZKAS maximum. No payment was signed or submitted.`,
      );
    }
    const signatures = await signer.verifyAndSign({
      network: this.network,
      recipient: to,
      amountSompi,
      maxFeeSompi,
      memo: memo ?? "",
      bundleHex: prepared.bundle_hex,
      disclosure: prepared.disclosure,
      spendAuth: prepared.spend_auth,
    });
    if (
      signatures.length === 0 ||
      signatures.some(
        (entry) =>
          !Number.isSafeInteger(entry.index) ||
          entry.index < 0 ||
          !/^[0-9a-fA-F]{128}$/.test(entry.sig),
      )
    ) {
      throw new Error("ZKas signer returned invalid signatures");
    }
    let rawSubmission: unknown;
    try {
      rawSubmission = await this.request(
        "/api/wallet/submit",
        {
          session: prepared.session,
          sigs: signatures,
        },
        input.beforeSubmit,
      );
    } catch (cause) {
      if (cause instanceof ZKasPreSubmitError) throw cause;
      throw new ZKasSubmissionUncertainError();
    }
    const parsed = submitSchema.safeParse(rawSubmission);
    if (!parsed.success) {
      const txid = z
        .object({ txid: submitSchema.shape.txid })
        .safeParse(rawSubmission);
      throw new ZKasSubmissionUncertainError(
        txid.success ? txid.data.txid : undefined,
      );
    }
    const submitted = parsed.data;
    let submittedAmount: bigint;
    let submittedFee: bigint;
    try {
      submittedAmount = parseZkasSompi(
        submitted.amount_sompi_exact,
        "submitted amount",
      );
      submittedFee = parseZkasSompi(submitted.fee_sompi_exact, "submitted fee");
    } catch {
      throw new ZKasSubmissionUncertainError(submitted.txid);
    }
    if (submittedAmount !== amountSompi || submittedFee !== preparedFee) {
      throw new ZKasSubmissionUncertainError(submitted.txid);
    }
    return { txid: submitted.txid, daemonReportedFeeSompi: preparedFee };
  }
}
