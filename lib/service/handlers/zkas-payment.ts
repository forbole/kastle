import { z } from "zod";
import { finishZKasDappPayment } from "@/api/background/zkas-dapp-payment";
import { ZKasSubmissionUncertainError } from "@/lib/zkas/client";
import { getZKasDaemonOriginPattern } from "@/lib/zkas/client";
import { parseZkasSompi } from "@/lib/zkas/amount";
import { validateZKasMemo } from "@/lib/zkas/memo";
import {
  DAEMON_BEARERS_KEY,
  canonicalDaemonBearerOrigin,
} from "@/lib/zkas/daemon-bearer";
import { zkasConnectionStore } from "@/lib/zkas/connection";
import {
  zkasDappPendingStore,
  type ZKasDappPending,
} from "@/lib/zkas/dapp-payment";
import { zkasKeyService } from "@/lib/zkas/key-service";
import { getZKasPaymentJournal } from "@/lib/zkas/payment-journal";
import { privateDaemonPayment } from "./zkas-daemon-transport";
import { assertCurrentConnected, pendingForPopup } from "./zkas-dapp";
import { ExtensionService, type Message } from "../extension-service";
import { Method } from "../methods";

const accountSchema = z
  .object({
    walletId: z.string().min(1).max(128),
    accountIndex: z.number().int().nonnegative().safe(),
    network: z.literal("mainnet"),
    address: z.string().min(1).max(256),
  })
  .strict();
const ordinarySchema = z
  .object({
    method: z.literal(Method.ZKAS_PAYMENT_SEND_ORDINARY),
    to: z.string().min(1).max(300),
    amountSompi: z.string().regex(/^[1-9]\d*$/),
    maxFeeSompi: z.string().regex(/^[1-9]\d*$/),
    memo: z.string().optional(),
    expectedAccount: accountSchema,
  })
  .strict();
const websiteSchema = z
  .object({
    method: z.literal(Method.ZKAS_PAYMENT_SEND_WEBSITE),
    approvalId: z.string().uuid(),
  })
  .strict();

type Account = z.infer<typeof accountSchema>;
type Payment = {
  to: string;
  amountSompi: bigint;
  maxFeeSompi: bigint;
  memo?: string;
};
type PaymentDto =
  | {
      status: "submitted";
      txid: string;
      daemonReportedFeeSompi: string;
      delivered?: boolean;
    }
  | { status: "uncertain"; txid?: string }
  | { status: "failed"; message: string };

class PaymentDeadlineError extends Error {}

class PaymentDeadline {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly expiry: Promise<never>;
  private readonly deadlineAt = performance.now() + 660_000;
  private expire!: (reason: Error) => void;
  private knownTxid: string | undefined;

  constructor() {
    this.expiry = new Promise<never>((_, reject) => {
      this.expire = reject;
    });
    // Entry can expire before race() subscribes; observe that rejection now.
    void this.expiry.catch(() => undefined);
    this.timer = setTimeout(() => {
      this.expireNow();
    }, 660_000);
  }

  private expireNow(): void {
    if (this.signal.aborted) return;
    this.controller.abort();
    this.expire(new PaymentDeadlineError("ZKas payment deadline exceeded"));
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  assertCurrent(): void {
    if (performance.now() >= this.deadlineAt) this.expireNow();
    if (this.signal.aborted)
      throw new PaymentDeadlineError("ZKas payment deadline exceeded");
  }

  async race<T>(work: Promise<T>): Promise<T> {
    this.assertCurrent();
    const value = await Promise.race([work, this.expiry]);
    this.assertCurrent();
    return value;
  }

  noteSubmitted(txid: string): void {
    this.knownTxid = txid;
  }

  uncertain(): PaymentDto {
    return {
      status: "uncertain",
      ...(this.knownTxid ? { txid: this.knownTxid } : {}),
    };
  }

  close(): void {
    clearTimeout(this.timer);
    this.controller.abort();
  }
}

function ordinaryPopup(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false;
  try {
    const actual = new URL(sender.url);
    const popup = new URL(browser.runtime.getURL("/popup.html"));
    return (
      actual.origin === popup.origin &&
      actual.pathname === popup.pathname &&
      actual.search === "" &&
      actual.hash === "#/zkas/send"
    );
  } catch {
    return false;
  }
}

function payment(
  to: string,
  rawAmount: string,
  rawFee: string,
  memo?: string,
): Payment {
  const amountSompi = parseZkasSompi(rawAmount, "amount");
  const maxFeeSompi = parseZkasSompi(rawFee, "fee ceiling");
  if (amountSompi === 0n || maxFeeSompi === 0n || !to.startsWith("zkas:"))
    throw new Error("Invalid ZKas payment");
  return { to, amountSompi, maxFeeSompi, memo: validateZKasMemo(memo) };
}

function failure(cause: unknown): PaymentDto {
  const message = cause instanceof Error ? cause.message : "";
  if (
    /^ZKas daemon proposes a fee of [0-9]+(?:\.[0-9]{1,8})? ZKAS, above your [0-9]+(?:\.[0-9]{1,8})? ZKAS maximum\. No payment was signed or submitted\.$/.test(
      message,
    )
  )
    return { status: "failed", message };
  return {
    status: "failed",
    message:
      "ZKas payment could not be completed. Check Kastle activity before retrying.",
  };
}

async function execute(
  expected: Account,
  effects: Payment,
  deadline: PaymentDeadline,
  website?: {
    pending: ZKasDappPending;
    generation: bigint;
    sender: chrome.runtime.MessageSender;
  },
): Promise<PaymentDto> {
  const journal = getZKasPaymentJournal();
  const selection = {
    walletId: expected.walletId,
    accountIndex: expected.accountIndex,
    network: expected.network,
  };
  let record: Awaited<ReturnType<typeof journal.acquire>>;
  try {
    record = await journal.acquire(selection);
  } catch (cause) {
    return deadline.signal.aborted ? deadline.uncertain() : failure(cause);
  }
  try {
    deadline.assertCurrent();
  } catch {
    await journal
      .clearStoppedBeforeFetch(selection, record.id)
      .catch(() => undefined);
    return deadline.uncertain();
  }
  let submitFetchAttempted = false;
  let journalSucceeded = false;
  let actual: { txid: string; daemonReportedFeeSompi: bigint } | undefined;
  const checkWebsite =
    website &&
    (async () => {
      if (zkasDappPendingStore.getGeneration() !== website.generation)
        throw new Error("ZKas payment approval changed");
      const current = await pendingForPopup(
        website.pending.approvalId,
        website.sender,
      );
      if (
        !current.processing ||
        JSON.stringify(current) !== JSON.stringify(website.pending)
      )
        throw new Error("ZKas payment approval changed");
      await assertCurrentConnected(website.pending);
      if (zkasDappPendingStore.getGeneration() !== website.generation)
        throw new Error("ZKas payment approval changed");
    });
  try {
    await checkWebsite?.();
    const result = await privateDaemonPayment(expected, effects, {
      signal: deadline.signal,
      beforeSubmit: async () => {
        await journal.markSubmitting(selection, record.id);
      },
      onSubmitFetchAttempt: () => {
        deadline.assertCurrent();
        submitFetchAttempted = true;
      },
      onSubmitted: async (submitted) => {
        actual = submitted;
        deadline.noteSubmitted(submitted.txid);
        await journal.markSuccess(selection, record.id, submitted.txid);
        journalSucceeded = true;
      },
      extraGuard: checkWebsite,
      assertSynchronous: () => {
        deadline.assertCurrent();
        if (
          website &&
          zkasDappPendingStore.getGeneration() !== website.generation
        )
          throw new Error("ZKas payment approval changed");
      },
      website: website && {
        origin: website.pending.origin,
        selection: website.pending.account,
      },
    });
    return {
      status: "submitted",
      txid: result.txid,
      daemonReportedFeeSompi: result.daemonReportedFeeSompi.toString(),
    };
  } catch (cause) {
    if (journalSucceeded && actual)
      return {
        status: "submitted",
        txid: actual.txid,
        daemonReportedFeeSompi: actual.daemonReportedFeeSompi.toString(),
      };
    if (submitFetchAttempted) {
      const txid =
        actual?.txid ??
        (cause instanceof ZKasSubmissionUncertainError
          ? cause.txid
          : undefined);
      await journal
        .markUncertain(selection, record.id, txid)
        .catch(() => undefined);
      return { status: "uncertain", ...(txid ? { txid } : {}) };
    }
    const cleared = await journal
      .clearStoppedBeforeFetch(selection, record.id)
      .then(() => true)
      .catch(() => false);
    return cleared && !deadline.signal.aborted
      ? failure(cause)
      : deadline.uncertain();
  }
}

export async function zkasPaymentSendOrdinary(
  message: Message,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  if (!ordinaryPopup(sender))
    throw new Error("ZKas payment requires the ordinary send window");
  const request = ordinarySchema.parse(message);
  const deadline = new PaymentDeadline();
  try {
    const work = execute(
      request.expectedAccount,
      payment(
        request.to,
        request.amountSompi,
        request.maxFeeSompi,
        request.memo,
      ),
      deadline,
    );
    void work.catch(() => undefined);
    const result = await deadline.race(work).catch((cause) => {
      if (cause instanceof PaymentDeadlineError) return deadline.uncertain();
      throw cause;
    });
    sendResponse(result);
  } finally {
    deadline.close();
  }
}

export async function zkasPaymentSendWebsite(
  message: Message,
  sendResponse: (value: unknown) => void,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const request = websiteSchema.parse(message);
  const deadline = new PaymentDeadline();
  const work = (async () => {
    const pending = await pendingForPopup(request.approvalId, sender);
    deadline.assertCurrent();
    await assertCurrentConnected(pending);
    deadline.assertCurrent();
    const effects = payment(
      pending.to,
      pending.amountSompi,
      pending.maxFeeSompi,
      pending.memo,
    );
    const initial = await zkasKeyService.credentials();
    deadline.assertCurrent();
    if (!initial.daemonUrl) throw new Error("Configure a ZKas daemon first");
    const daemonOrigin = canonicalDaemonBearerOrigin(initial.daemonUrl);
    const claimed = await zkasDappPendingStore.claim(request.approvalId);
    deadline.assertCurrent();
    const generation = zkasDappPendingStore.getGeneration();
    const website = { pending: claimed, generation, sender };
    const keyring = ExtensionService.getInstance().getKeyring();
    const session = keyring.getSessionVersion();
    const walletsGeneration = keyring.getMutationGeneration("wallets");
    const bearerGeneration = keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    const connectionGeneration = zkasConnectionStore.getGeneration();
    const result = await execute(
      claimed.account as Account,
      effects,
      deadline,
      website,
    );
    const fence = {
      check: async () => {
        await assertCurrentConnected(claimed);
        const current = await zkasKeyService.credentials();
        if (
          current.walletId !== claimed.account.walletId ||
          current.accountIndex !== claimed.account.accountIndex ||
          current.network !== claimed.account.network ||
          current.address !== claimed.account.address ||
          current.keyringVersion !== session ||
          !current.daemonUrl ||
          canonicalDaemonBearerOrigin(current.daemonUrl) !== daemonOrigin
        )
          throw new Error("ZKas payment context changed");
        if (
          !(await browser.permissions.contains({
            origins: [getZKasDaemonOriginPattern(current.daemonUrl)],
          }))
        )
          throw new Error("ZKas daemon permission changed");
      },
      synchronous: () => {
        deadline.assertCurrent();
        if (
          !keyring.isUnlocked() ||
          keyring.getSessionVersion() !== session ||
          keyring.getMutationGeneration("wallets") !== walletsGeneration ||
          keyring.getMutationGeneration(DAEMON_BEARERS_KEY) !==
            bearerGeneration ||
          zkasConnectionStore.getGeneration() !== connectionGeneration
        )
          throw new Error("ZKas payment context changed");
      },
    };
    const outcome =
      result.status === "submitted"
        ? {
            txid: result.txid,
            daemonReportedFeeSompi: result.daemonReportedFeeSompi,
          }
        : {
            error:
              result.status === "uncertain"
                ? "ZKas payment outcome is uncertain. Check Kastle activity before retrying."
                : "ZKas payment failed. Check the Kastle window for details.",
          };
    const completion = await finishZKasDappPayment(
      request.approvalId,
      outcome,
      fence,
    );
    return result.status === "submitted"
      ? { ...result, delivered: completion.delivered }
      : result;
  })();
  void work.catch(() => undefined);
  try {
    const result = await deadline.race(work).catch((cause) => {
      if (cause instanceof PaymentDeadlineError) return deadline.uncertain();
      throw cause;
    });
    sendResponse(result);
  } finally {
    deadline.close();
  }
}
