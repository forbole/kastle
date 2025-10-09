import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useSettings } from "@/hooks/useSettings";
import useEvmBackgroundSigner from "./useEvmBackgroundSigner";
import { publicKeyToAddress } from "viem/accounts";
import {
  TransactionSerializable,
  SignTypedDataParameters,
  serializeTransaction,
} from "viem";

export default function useEvmHotWalletSigner() {
  const { wallet: walletInfo, account } = useWalletManager();
  const signer = useEvmBackgroundSigner();
  const [settings] = useSettings();

  const isLegacy = settings?.isLegacyEvmAddressEnabled ?? false;

  if (!walletInfo || !account) {
    return undefined;
  }

  const getPublicKey = async () => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;

    const { publicKey } = await signer.getPublicKey({
      walletId,
      accountIndex,
      isLegacy,
    });
    return publicKey;
  };

  const getAddress = async () => {
    const publicKey = await getPublicKey();
    return publicKeyToAddress(publicKey);
  };

  const signTransaction = async (transaction: TransactionSerializable) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;

    const { signedTransaction } = await signer.signTransaction({
      walletId,
      accountIndex,
      isLegacy,
      transaction: serializeTransaction(transaction),
    });
    return signedTransaction;
  };

  const signMessage = async (message: string) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;

    const { signature } = await signer.signMessage({
      walletId,
      accountIndex,
      isLegacy,
      message,
    });

    return signature;
  };

  const signTypedData = async (data: SignTypedDataParameters) => {
    const walletId = walletInfo.id;
    const accountIndex = account.index;

    const { signature } = await signer.signTypedData({
      walletId,
      accountIndex,
      isLegacy,
      data: data.toString(),
    });

    return signature;
  };

  return {
    getPublicKey,
    getAddress,
    signTransaction,
    signMessage,
    signTypedData,
  };
}
