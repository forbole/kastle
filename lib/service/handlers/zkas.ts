import { zkasKeyService, type ZKasSignRequest } from "@/lib/zkas/key-service";
import type { ZKasSelection } from "@/lib/zkas/selection";
import { getZKasPaymentJournal } from "@/lib/zkas/payment-journal";
import { zkasConnectionStore } from "@/lib/zkas/connection";
import type { Message } from "../extension-service";

export const zkasGetAccount = async (_: Message, sendResponse: (value: unknown) => void) => {
  sendResponse(await zkasKeyService.publicAccount());
};

export const zkasGetSelectedAddress = async (_: Message, sendResponse: (value: unknown) => void) => {
  sendResponse(await zkasKeyService.selectedAddress());
};

export const zkasGetSwitchAccounts = async (_: Message, sendResponse: (value: unknown) => void) => {
  sendResponse(await zkasKeyService.switchAccounts());
};

export const zkasPreviewSeed = async (
  { seedHex }: Message<{ seedHex: string }>,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.previewSeed(seedHex));
};

export const zkasImportSeed = async (
  { seedHex, expectedAccount }: Message<{ seedHex: string; expectedAccount: { network: "mainnet"; address: string } }>,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.importSeed(seedHex, expectedAccount));
};

export const zkasGetCredentials = async (_: Message, sendResponse: (value: unknown) => void) => {
  sendResponse(await zkasKeyService.credentials());
};

export const zkasCheckSelection = async (
  { selection, daemonUrl, keyringVersion }: Message<{ selection: ZKasSelection; daemonUrl: string; keyringVersion: number }>,
  sendResponse: (value: unknown) => void,
) => {
  await zkasKeyService.checkSelection(selection, daemonUrl, keyringVersion);
  sendResponse({ ok: true });
};

export const zkasSign = async (
  request: Message<ZKasSignRequest>,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse({ signatures: await zkasKeyService.sign(request) });
};

type PaymentMessage = Message<{ selection: ZKasSelection; keyringVersion: number; id: string; txid?: string }>;

export const zkasPaymentStatus = async (_: Message, sendResponse: (value: unknown) => void) => {
  const selection = await zkasKeyService.publicAccount();
  sendResponse((await getZKasPaymentJournal().get(selection)) ?? null);
};

export const zkasPaymentAcquire = async (
  { selection, keyringVersion }: PaymentMessage,
  sendResponse: (value: unknown) => void,
) => {
  await zkasKeyService.checkSelection(selection, undefined, keyringVersion);
  sendResponse(await getZKasPaymentJournal().acquire(selection));
};

export const zkasPaymentSubmitting = async (
  { selection, keyringVersion, id, daemonUrl }: PaymentMessage & { daemonUrl: string },
  sendResponse: (value: unknown) => void,
) => {
  await zkasKeyService.checkSelection(selection, daemonUrl, keyringVersion);
  await getZKasPaymentJournal().markSubmitting(selection, id);
  sendResponse({ ok: true });
};

export const zkasPaymentUncertain = async (
  { selection, id, txid }: PaymentMessage,
  sendResponse: (value: unknown) => void,
) => {
  if (txid !== undefined && !/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error("Invalid ZKas transaction ID");
  await getZKasPaymentJournal().markUncertain(selection, id, txid);
  sendResponse({ ok: true });
};

export const zkasPaymentSuccess = async (
  { selection, id, txid }: PaymentMessage,
  sendResponse: (value: unknown) => void,
) => {
  if (!txid || !/^[0-9a-fA-F]{64}$/.test(txid)) throw new Error("Invalid ZKas transaction ID");
  await getZKasPaymentJournal().markSuccess(selection, id, txid);
  sendResponse({ ok: true });
};

export const zkasPaymentRelease = async (
  { selection, id }: PaymentMessage,
  sendResponse: (value: unknown) => void,
) => {
  await getZKasPaymentJournal().release(selection, id);
  sendResponse({ ok: true });
};

export const zkasPaymentClear = async (
  { selection, id }: PaymentMessage,
  sendResponse: (value: unknown) => void,
) => {
  await zkasKeyService.checkSelection(selection);
  await getZKasPaymentJournal().clearAfterReview(selection, id);
  sendResponse({ ok: true });
};

export const zkasPaymentAbortBeforeFetch = async (
  { selection, id }: PaymentMessage,
  sendResponse: (value: unknown) => void,
) => {
  await getZKasPaymentJournal().abortBeforeFetch(selection, id);
  sendResponse({ ok: true });
};

export const zkasConnectionRemove = async (
  { origin }: Message<{ origin: string }>,
  sendResponse: (value: unknown) => void,
) => {
  await zkasConnectionStore.remove(origin);
  sendResponse({ ok: true });
};
