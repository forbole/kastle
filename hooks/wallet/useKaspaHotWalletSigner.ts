import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBackgroundSigner from "./useKaspaBackgroundSigner";
import { Transaction, PublicKey } from "@/wasm/core/kaspa";
import type { ScriptOption } from "@/lib/wallet/wallet-interface";
import { hexToBytes } from "@noble/hashes/utils";
import { BraidSignRefusal, type BraidDeposit } from "@/lib/braid/signer";
import { resolveAccountIsLegacy } from "@/lib/wallet/resolve-derivation";

export default function useKaspaHotWalletSigner() {
  const { wallet: walletInfo, account } = useWalletManager();
  const { networkId } = useRpcClientStateful();
  const signer = useKaspaBackgroundSigner();

  if (!walletInfo || !account || !networkId) {
    return undefined;
  }

  const keysFor = async (isLegacy: boolean) => {
    const { publicKeys } = await signer.getPublicKeys({
      walletId: walletInfo.id,
      accountIndex: account.index,
      isLegacy,
    });
    return publicKeys;
  };

  // The derivation whose key holds this account's funds; the flag alone can
  // name the other one (see resolveIsLegacy).
  const resolveLegacy = () =>
    resolveAccountIsLegacy(
      walletInfo.id,
      account.index,
      account.address,
      walletInfo.isLegacyWalletEnabled ?? false,
      networkId,
      async (isLegacy) => (await keysFor(isLegacy))[0],
    );

  const getPublicKeys = async () => keysFor(await resolveLegacy());

  const getPublicKey = async () => {
    const publicKeys = await getPublicKeys();
    return new PublicKey(publicKeys[0]);
  };

  const getAddress = async () => {
    return (await getPublicKey()).toAddress(networkId).toString();
  };

  const signTx = async (transaction: Transaction, scripts?: ScriptOption[]) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;
    const signedTransaction = await signer.signTransaction({
      transactionJSON: transaction.serializeToSafeJSON(),
      scripts,
      walletId,
      accountIndex,
      networkId,
      isLegacy: await resolveLegacy(),
    });

    const { signedTransactionJSON } = signedTransaction ?? {};
    if (!signedTransactionJSON) {
      throw new Error(
        "signTx: background signer returned no signed transaction",
      );
    }
    // Background service always returns new-WASM serialised JSON
    return Transaction.deserializeFromSafeJSON(signedTransactionJSON);
  };

  const signInputDigest = async (
    transaction: Transaction,
    inputIndex: number,
  ) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;

    const { signatureHex } = await signer.signInputDigest({
      transactionJSON: transaction.serializeToSafeJSON(),
      inputIndex,
      walletId,
      accountIndex,
      networkId,
      isLegacy: await resolveLegacy(),
    });

    return hexToBytes(signatureHex);
  };

  // The background signs with the account key; only the fields the signer
  // checks cross over. A refusal there comes back as one here: nothing signed.
  const signBraidDeposit = async (deposit: BraidDeposit) => {
    const response = await signer.signBraidDeposit({
      walletId: walletInfo.id,
      accountIndex: account.index,
      isLegacy: await resolveLegacy(),
      deposit: {
        ref: deposit.ref,
        network: deposit.network,
        userPublicKey: deposit.userPublicKey,
        signInputs: deposit.signInputs,
        sighashes: deposit.sighashes,
        walletJson: deposit.walletJson,
      },
    });
    if (!response) {
      throw new Error("signBraidDeposit: background signer returned nothing");
    }
    if ("refusal" in response) throw new BraidSignRefusal(response.refusal);
    return response.signatures;
  };

  const signMessage = async (message: string) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;
    const { signedMessage } = await signer.signMessage({
      message,
      walletId,
      accountIndex,
      networkId,
      isLegacy: await resolveLegacy(),
    });
    return signedMessage;
  };

  return {
    getPublicKeys,
    getPublicKey,
    signTx,
    signInputDigest,
    signBraidDeposit,
    signMessage,
    getAddress,
  };
}
