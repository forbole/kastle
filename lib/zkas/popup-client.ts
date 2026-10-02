import { Method } from "@/lib/service/methods";
import { sendMessage } from "@/lib/utils";
import { parseZkasAmount, parseZkasSompi } from "./amount";
import {
  getZKasDaemonOriginPattern,
  type ZKasHistory,
  type ZKasState,
} from "./client";
import { type ZKasSelection, type ZKasSwitchAccount } from "./selection";
import type { ZKasPaymentRecord } from "./payment-journal";
import { ZKasSubmissionUncertainError } from "./client";
import { validateZKasMemo } from "./memo";

type InternalError = { error: string };
let paymentInProgress = false;

async function internal<T>(method: Method, data: object = {}): Promise<T> {
  const response = await sendMessage<T | InternalError>(method, data);
  if (response && typeof response === "object" && "error" in response) {
    throw new Error(response.error);
  }
  return response as T;
}

export type PublicZKasAccount = ZKasSelection & { address: string };

export async function getZKasPublicAccount(): Promise<PublicZKasAccount> {
  return internal(Method.ZKAS_GET_ACCOUNT);
}

export async function getSelectedZKasAddress(): Promise<PublicZKasAccount | null> {
  return internal(Method.ZKAS_GET_SELECTED_ADDRESS);
}

export async function getZKasSwitchAccounts(): Promise<ZKasSwitchAccount[]> {
  return internal(Method.ZKAS_GET_SWITCH_ACCOUNTS);
}

export async function getZKasDaemonBirthday(
  daemonUrl: string,
  network: "mainnet" = "mainnet",
): Promise<number> {
  const pattern = getZKasDaemonOriginPattern(daemonUrl);
  if (!(await browser.permissions.contains({ origins: [pattern] }))) {
    throw new Error("Allow Kastle access to the selected ZKas daemon first");
  }
  const result = await internal<{ birthday: number }>(
    Method.ZKAS_DAEMON_BIRTHDAY,
    {
      origin: daemonUrl,
      network,
    },
  );
  if (!Number.isSafeInteger(result.birthday) || result.birthday < 0)
    throw new Error("Invalid ZKas daemon birthday");
  return result.birthday;
}

export async function registerSelectedZKasWallet(
  expectedAccount: ZKasSelection & { address?: string },
  expectedDaemonUrl: string,
  birthday = 0,
): Promise<void> {
  await internal(Method.ZKAS_DAEMON_REGISTER, {
    expectedAccount,
    expectedOrigin: expectedDaemonUrl,
    birthday,
  });
}

export async function previewZKasSeed(
  seedHex: string,
): Promise<{ network: "mainnet"; address: string }> {
  return internal(Method.ZKAS_PREVIEW_SEED, { seedHex });
}

export async function importZKasSeed(
  seedHex: string,
  expectedAccount: { network: "mainnet"; address: string },
): Promise<PublicZKasAccount> {
  return internal(Method.ZKAS_IMPORT_SEED, { seedHex, expectedAccount });
}

export async function getZKasPaymentRecord(): Promise<ZKasPaymentRecord | null> {
  return internal(Method.ZKAS_PAYMENT_STATUS);
}

export async function clearZKasPaymentRecord(
  record: ZKasPaymentRecord,
): Promise<void> {
  await internal(Method.ZKAS_PAYMENT_CLEAR, {
    selection: record.selection,
    id: record.id,
  });
}

export async function getZKasState(
  expectedAccount?: PublicZKasAccount,
): Promise<ZKasState> {
  const state = await internal<
    Omit<ZKasState, "balanceSompi"> & { balanceSompi: string }
  >(Method.ZKAS_DAEMON_STATE, { expectedAccount });
  return {
    ...state,
    balanceSompi: parseZkasSompi(state.balanceSompi, "balance"),
  };
}

export async function getZKasHistory(
  expectedAccount?: PublicZKasAccount,
): Promise<ZKasHistory> {
  return internal<ZKasHistory>(Method.ZKAS_DAEMON_RECENT_HISTORY, {
    expectedAccount,
  });
}

type PaymentResult =
  | {
      status: "submitted";
      txid: string;
      daemonReportedFeeSompi: string;
      delivered?: boolean;
    }
  | { status: "uncertain"; txid?: string }
  | { status: "failed"; message: string };

function paymentResult(value: PaymentResult): {
  txid: string;
  daemonReportedFeeSompi: string;
  delivered?: boolean;
} {
  if (value.status === "uncertain")
    throw new ZKasSubmissionUncertainError(value.txid);
  if (value.status === "failed") throw new Error(value.message);
  return {
    txid: value.txid,
    daemonReportedFeeSompi: value.daemonReportedFeeSompi,
    delivered: value.delivered,
  };
}

export async function sendZKasPayment(input: {
  to: string;
  amount: string;
  maxFee: string;
  memo?: string;
  expectedAccount: PublicZKasAccount;
  guard?: () => Promise<void>;
}): Promise<{ txid: string; daemonReportedFeeSompi: string }> {
  if (paymentInProgress)
    throw new Error("A ZKas payment is already in progress");
  paymentInProgress = true;
  try {
    await input.guard?.();
    const result = await internal<PaymentResult>(
      Method.ZKAS_PAYMENT_SEND_ORDINARY,
      {
        to: input.to,
        amountSompi: parseZkasAmount(input.amount).toString(),
        maxFeeSompi: parseZkasAmount(input.maxFee).toString(),
        memo: validateZKasMemo(input.memo),
        expectedAccount: input.expectedAccount,
      },
    );
    return paymentResult(result);
  } finally {
    paymentInProgress = false;
  }
}

export async function sendApprovedZKasWebsitePayment(
  approvalId: string,
): Promise<{
  txid: string;
  daemonReportedFeeSompi: string;
  delivered?: boolean;
}> {
  return paymentResult(
    await internal<PaymentResult>(Method.ZKAS_PAYMENT_SEND_WEBSITE, {
      approvalId,
    }),
  );
}
