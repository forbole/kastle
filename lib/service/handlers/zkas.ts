import { zkasKeyService } from "@/lib/zkas/key-service";
import { getZKasPaymentJournal } from "@/lib/zkas/payment-journal";
import { zkasConnectionStore } from "@/lib/zkas/connection";
import type { ZKasSelection } from "@/lib/zkas/selection";
import type { Message } from "../extension-service";

export const zkasGetAccount = async (
  _: Message,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.publicAccount());
};

export const zkasGetSelectedAddress = async (
  _: Message,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.selectedAddress());
};

export const zkasGetSwitchAccounts = async (
  _: Message,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.switchAccounts());
};

export const zkasPreviewSeed = async (
  { seedHex }: Message<{ seedHex: string }>,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.previewSeed(seedHex));
};

export const zkasImportSeed = async (
  {
    seedHex,
    expectedAccount,
  }: Message<{
    seedHex: string;
    expectedAccount: { network: "mainnet"; address: string };
  }>,
  sendResponse: (value: unknown) => void,
) => {
  sendResponse(await zkasKeyService.importSeed(seedHex, expectedAccount));
};

export const zkasPaymentStatus = async (
  _: Message,
  sendResponse: (value: unknown) => void,
) => {
  const selection = await zkasKeyService.publicAccount();
  sendResponse((await getZKasPaymentJournal().get(selection)) ?? null);
};

export const zkasPaymentClear = async (
  { selection, id }: Message<{ selection: ZKasSelection; id: string }>,
  sendResponse: (value: unknown) => void,
) => {
  await zkasKeyService.checkSelection(selection);
  await getZKasPaymentJournal().clearAfterReview(selection, id);
  sendResponse({ ok: true });
};

export const zkasConnectionRemove = async (
  { origin }: Message<{ origin: string }>,
  sendResponse: (value: unknown) => void,
) => {
  await zkasConnectionStore.remove(origin);
  sendResponse({ ok: true });
};
