import { z } from "zod";
import { MAX_ZKAS_SOMPI, parseZkasSompi } from "./amount";

export type ZKasNetwork = "mainnet" | "testnet";

export interface ZKasSigner {
  address(): string;
  fullViewingKeyHex(): Promise<string>;
  verifyAndSign(input: {
    network: ZKasNetwork;
    recipient: string;
    amountSompi: bigint;
    maxFeeSompi: bigint;
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

export type ZKasState = {
  address: string;
  balanceSompi: bigint;
  synced: boolean;
  missingHistory: boolean;
};

export class ZKasSubmissionUncertainError extends Error {
  readonly txid?: string;

  constructor(txid?: string) {
    super("ZKas payment outcome is uncertain. Check wallet history before trying again.");
    this.name = "ZKasSubmissionUncertainError";
    this.txid = txid;
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

export class ZKasClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly network: ZKasNetwork;
  private readonly fetcher: typeof fetch;

  constructor(config: {
    baseUrl: string;
    token: string;
    network: ZKasNetwork;
    fetch?: typeof fetch;
  }) {
    this.baseUrl = validatedBaseUrl(config.baseUrl);
    if (!/^[0-9a-fA-F]{32}$/.test(config.token)) {
      throw new Error("Invalid ZKas wallet token");
    }
    this.token = config.token;
    this.network = config.network;
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-Wallet-Token": this.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error(`ZKas daemon returned HTTP ${response.status}`);
    }
    return response.json();
  }

  async state(fvkHex: string, expectedAddress: string): Promise<ZKasState> {
    if (!/^[0-9a-fA-F]{192}$/.test(fvkHex)) {
      throw new Error("Invalid ZKas viewing key");
    }
    const status = statusSchema.parse(await this.request("/api/status"));
    if (status.network !== this.network) {
      throw new Error("ZKas daemon network does not match the selected network");
    }
    let address = status.address;
    if (!status.has_wallet) {
      const watch = watchSchema.parse(
        await this.request("/api/wallet/watch", {
          fvk_hex: fvkHex,
          birthday: 0,
        }),
      );
      address = watch.address;
    }
    const expectedPrefix = this.network === "mainnet" ? "zkas:" : "zkastest:";
    if (!expectedAddress.startsWith(expectedPrefix) || address !== expectedAddress) {
      throw new Error("ZKas daemon address does not match the local account");
    }
    const balance = balanceSchema.parse(await this.request("/api/wallet/balance"));
    return {
      address,
      balanceSompi: parseZkasSompi(balance.balance_sompi, "balance"),
      synced: status.node_connected && status.synced,
      missingHistory: status.missing_history === true,
    };
  }

  async send(input: {
    signer: ZKasSigner;
    to: string;
    amountSompi: bigint;
    maxFeeSompi: bigint;
  }): Promise<{ txid: string; daemonReportedFeeSompi: bigint }> {
    if (this.network !== "mainnet") {
      throw new Error("The pinned ZKas signer cannot approve testnet payments");
    }
    const { signer, amountSompi, maxFeeSompi } = input;
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
        allow_partial: false,
      }),
    );
    const preparedAmount = parseZkasSompi(
      prepared.amount_sompi_exact,
      "prepared amount",
    );
    const preparedFee = parseZkasSompi(prepared.fee_sompi_exact, "prepared fee");
    const remaining = parseZkasSompi(
      prepared.remaining_sompi_exact ?? "0",
      "remaining amount",
    );
    if (remaining !== 0n) throw new Error("ZKas payment would be partial");
    if (preparedAmount !== amountSompi) {
      throw new Error("ZKas daemon changed the payment amount");
    }
    if (preparedFee > maxFeeSompi) {
      throw new Error("ZKas fee exceeds the approved maximum");
    }
    const signatures = await signer.verifyAndSign({
      network: this.network,
      recipient: to,
      amountSompi,
      maxFeeSompi,
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
      rawSubmission = await this.request("/api/wallet/submit", {
        session: prepared.session,
        sigs: signatures,
      });
    } catch {
      throw new ZKasSubmissionUncertainError();
    }
    const parsed = submitSchema.safeParse(rawSubmission);
    if (!parsed.success) {
      const txid = z.object({ txid: submitSchema.shape.txid }).safeParse(rawSubmission);
      throw new ZKasSubmissionUncertainError(txid.success ? txid.data.txid : undefined);
    }
    const submitted = parsed.data;
    let submittedAmount: bigint;
    let submittedFee: bigint;
    try {
      submittedAmount = parseZkasSompi(submitted.amount_sompi_exact, "submitted amount");
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
