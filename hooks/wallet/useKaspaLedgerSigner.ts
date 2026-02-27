import useLedgerTransport from "@/hooks/useLedgerTransport";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "./useWalletManager";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/wallet/account-factory";

export default function useKaspaLedgerSigner() {
  const { networkId } = useRpcClientStateful();
  const { wallet: walletInfo, account } = useWalletManager();
  const { transport, isAppOpen } = useLedgerTransport();

  if (!networkId || !walletInfo || !transport || !isAppOpen) {
    return undefined;
  }

  const isLegacyEnabled = walletInfo.isLegacyWalletEnabled ?? false;
  const factory = isLegacyEnabled
    ? new LegacyAccountFactory()
    : new AccountFactory();

  const getAddress = async () => {
    const accountIndex = account?.index ?? 0;
    const publicKey = await factory
      .createFromLedger(transport, accountIndex)
      .getPublicKey();
    const address = publicKey.toAddress(networkId).toString();
    return address;
  };

  const signer = factory.createFromLedger(transport);

  return {
    getAddress,
    signTx: signer.signTx.bind(signer),
    getPublicKey: signer.getPublicKey.bind(signer),
    getPublicKeys: signer.getPublicKeys.bind(signer),
    signMessage: signer.signMessage.bind(signer),
  };
}
