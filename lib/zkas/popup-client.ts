import { Method } from "@/lib/service/methods";
import { sendMessage } from "@/lib/utils";
import { parseZkasAmount } from "./amount";
import {
  getZKasDaemonOriginPattern,
  ZKasClient,
  type ZKasHistory,
  type ZKasSigner,
  type ZKasState,
} from "./client";
import type { ZKasCredentials, ZKasSignRequest } from "./key-service";
import type { ZKasSelection, ZKasSwitchAccount } from "./selection";
import type { ZKasPaymentRecord } from "./payment-journal";
import { ZKasPreSubmitError, ZKasSubmissionUncertainError } from "./client";

type InternalError = { error: string };
let paymentInProgress = false;

async function internal<T>(method: Method, data: object = {}): Promise<T> {
  const response = await sendMessage<T | InternalError>(method, data);
  if (response && typeof response === "object" && "error" in response) {
    throw new Error(response.error);
  }
  return response as T;
}

async function permittedClient(
  credentials: ZKasCredentials,
  extraGuard?: () => Promise<void>,
): Promise<ZKasClient> {
  if (!credentials.daemonUrl) throw new Error("Configure a ZKas daemon first");
  const guard = async () => {
    await extraGuard?.();
    await internal(Method.ZKAS_CHECK_SELECTION, {
      selection: selectionOf(credentials),
      daemonUrl: credentials.daemonUrl,
      keyringVersion: credentials.keyringVersion,
    });
    const pattern = getZKasDaemonOriginPattern(credentials.daemonUrl!);
    if (!(await browser.permissions.contains({ origins: [pattern] }))) {
      throw new Error("Allow Kastle access to the selected ZKas daemon first");
    }
  };
  await guard();
  return new ZKasClient({
    baseUrl: credentials.daemonUrl,
    token: credentials.walletToken,
    network: credentials.network,
    guard,
  });
}

function selectionOf(credentials: ZKasCredentials): ZKasSelection {
  return {
    walletId: credentials.walletId,
    accountIndex: credentials.accountIndex,
    network: credentials.network,
  };
}

export type PublicZKasAccount = ZKasSelection & { address: string };

function assertExpectedAccount(
  credentials: ZKasCredentials,
  expectedAccount?: PublicZKasAccount,
): void {
  if (
    expectedAccount &&
    (credentials.address !== expectedAccount.address ||
      credentials.walletId !== expectedAccount.walletId ||
      credentials.accountIndex !== expectedAccount.accountIndex ||
      credentials.network !== expectedAccount.network)
  ) {
    throw new Error("Selected ZKas account changed. Refresh this screen.");
  }
}

export async function getZKasPublicAccount(): Promise<PublicZKasAccount> {
  return internal(Method.ZKAS_GET_ACCOUNT);
}

export async function getSelectedZKasAddress(): Promise<PublicZKasAccount | null> {
  return internal(Method.ZKAS_GET_SELECTED_ADDRESS);
}

export async function getZKasSwitchAccounts(): Promise<ZKasSwitchAccount[]> {
  return internal(Method.ZKAS_GET_SWITCH_ACCOUNTS);
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
  const credentials = await internal<ZKasCredentials>(
    Method.ZKAS_GET_CREDENTIALS,
  );
  assertExpectedAccount(credentials, expectedAccount);
  const client = await permittedClient(credentials);
  return client.state(credentials.fullViewingKeyHex, credentials.address);
}

export async function getZKasHistory(
  expectedAccount?: PublicZKasAccount,
): Promise<ZKasHistory> {
  const credentials = await internal<ZKasCredentials>(
    Method.ZKAS_GET_CREDENTIALS,
  );
  assertExpectedAccount(credentials, expectedAccount);
  const client = await permittedClient(credentials);
  await client.state(credentials.fullViewingKeyHex, credentials.address);
  return client.history();
}

export async function sendZKasPayment(input: {
  to: string;
  amount: string;
  maxFee: string;
  expectedAccount: PublicZKasAccount;
  guard?: () => Promise<void>;
}): Promise<{ txid: string; daemonReportedFeeSompi: string }> {
  if (paymentInProgress)
    throw new Error("A ZKas payment is already in progress");
  paymentInProgress = true;
  try {
    await input.guard?.();
    const amountSompi = parseZkasAmount(input.amount);
    const maxFeeSompi = parseZkasAmount(input.maxFee);
    const credentials = await internal<ZKasCredentials>(
      Method.ZKAS_GET_CREDENTIALS,
    );
    assertExpectedAccount(credentials, input.expectedAccount);
    const client = await permittedClient(credentials, input.guard);
    const selection = selectionOf(credentials);
    const record = await internal<ZKasPaymentRecord>(
      Method.ZKAS_PAYMENT_ACQUIRE,
      {
        selection,
        keyringVersion: credentials.keyringVersion,
      },
    );
    let submitting = false;
    const signer: ZKasSigner = {
      address: () => credentials.address,
      fullViewingKeyHex: async () => credentials.fullViewingKeyHex,
      verifyAndSign: async (prepared) => {
        await input.guard?.();
        const request: ZKasSignRequest = {
          selection,
          keyringVersion: credentials.keyringVersion,
          daemonUrl: credentials.daemonUrl!,
          recipient: prepared.recipient,
          amountSompi: prepared.amountSompi.toString(),
          maxFeeSompi: prepared.maxFeeSompi.toString(),
          bundleHex: prepared.bundleHex,
          disclosure: prepared.disclosure as unknown[],
          spendAuth: prepared.spendAuth as unknown[],
        };
        const result = await internal<{
          signatures: { index: number; sig: string }[];
        }>(Method.ZKAS_SIGN, request);
        return result.signatures;
      },
    };
    try {
      const result = await client.send({
        signer,
        to: input.to,
        amountSompi,
        maxFeeSompi,
        beforeSubmit: async () => {
          await input.guard?.();
          await internal(Method.ZKAS_PAYMENT_SUBMITTING, {
            selection,
            keyringVersion: credentials.keyringVersion,
            daemonUrl: credentials.daemonUrl,
            id: record.id,
          });
          submitting = true;
        },
      });
      await internal(Method.ZKAS_PAYMENT_SUCCESS, {
        selection,
        id: record.id,
        txid: result.txid,
      });
      return {
        txid: result.txid,
        daemonReportedFeeSompi: result.daemonReportedFeeSompi.toString(),
      };
    } catch (cause) {
      if (cause instanceof ZKasPreSubmitError) {
        await internal(
          submitting
            ? Method.ZKAS_PAYMENT_ABORT_BEFORE_FETCH
            : Method.ZKAS_PAYMENT_RELEASE,
          {
            selection,
            id: record.id,
          },
        ).catch(() => undefined);
        throw cause;
      }
      if (submitting) {
        const txid =
          cause instanceof ZKasSubmissionUncertainError
            ? cause.txid
            : undefined;
        await internal(Method.ZKAS_PAYMENT_UNCERTAIN, {
          selection,
          id: record.id,
          txid,
        }).catch(() => undefined);
        throw cause instanceof ZKasSubmissionUncertainError
          ? cause
          : new ZKasSubmissionUncertainError(txid);
      }
      await internal(Method.ZKAS_PAYMENT_RELEASE, {
        selection,
        id: record.id,
      }).catch(() => undefined);
      throw cause;
    }
  } finally {
    paymentInProgress = false;
  }
}
