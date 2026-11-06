import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import {
  BraidSignRefusal,
  braidSignerFor,
  type BraidDeposit,
} from "@/lib/braid/signer";
import { withOwned } from "@/lib/wallet/wasm-lifecycle.ts";
import { getSigner } from "./utils";

export type KaspaSignBraidDepositRequest = {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean;
  deposit: BraidDeposit;
};

/**
 * The signatures, or the pre-sign check that refused the deposit. A refusal
 * travels as data: a thrown error reaches the popup as a bare string, and
 * the popup must know that nothing was signed.
 */
export type KaspaSignBraidDepositResponse =
  | { signatures: Record<number, string> }
  | { refusal: string };

/**
 * Signs a Braid deposit with the account's own key, which never leaves this
 * context. The x-only key comes from the account, not from the request, so
 * the signer's key check compares the deposit with the real wallet key.
 * braidSignerFor refuses any account that is not a hot key.
 */
export async function kaspaSignBraidDepositHandler(
  {
    walletId,
    accountIndex,
    isLegacy,
    deposit,
  }: Message<KaspaSignBraidDepositRequest>,
  sendResponse: (response: KaspaSignBraidDepositResponse) => void,
) {
  const keyring = ExtensionService.getInstance().getKeyring();
  const isInitialized = await keyring.isInitialized();
  if (!isInitialized || !keyring.isUnlocked()) {
    throw new Error("Keyring not initialized or locked");
  }

  const account = await getSigner(walletId, accountIndex, isLegacy);
  const publicKey = await account.getPublicKey();
  const xOnlyPk = withOwned((own) =>
    own(own(publicKey).toXOnlyPublicKey()).toString(),
  );
  try {
    const signatures = await braidSignerFor(account, xOnlyPk).signDeposit(
      deposit,
    );
    sendResponse({ signatures });
  } catch (e) {
    if (e instanceof BraidSignRefusal) {
      sendResponse({ refusal: e.reason });
      return;
    }
    throw e;
  }
}
