import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBackgroundSigner from "./useKaspaBackgroundSigner";
import { Transaction, PublicKey } from "@/wasm/core/kaspa";
import { ScriptOption } from "@/lib/wallet/wallet-interface";

export default function useKaspaHotWalletSigner() {
  const { wallet: walletInfo, account } = useWalletManager();
  const { networkId } = useRpcClientStateful();
  const signer = useKaspaBackgroundSigner();

  if (!walletInfo || !account || !networkId) {
    return undefined;
  }

  const getPublicKeys = async () => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;
    const { publicKeys } = await signer.getPublicKeys({
      walletId,
      accountIndex,
    });
    return publicKeys;
  };

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
    });

    const { signedTransactionJSON } = signedTransaction;
    const tx = Transaction.deserializeFromSafeJSON(signedTransactionJSON);
    return tx;
  };

  const signMessage = async (message: string) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;
    const { signedMessage } = await signer.signMessage({
      message,
      walletId,
      accountIndex,
    });
    return signedMessage;
  };

  return {
    getPublicKeys,
    getPublicKey,
    signTx,
    signMessage,
    getAddress,
  };
}
