import useLedgerTransport from "@/hooks/useLedgerTransport";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "./useWalletManager";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/wallet/account-factory";
import type { IWallet } from "@/lib/wallet/wallet-interface";
import { resolveAccountIsLegacy } from "@/lib/wallet/resolve-derivation";

export default function useKaspaLedgerSigner() {
  const { networkId } = useRpcClientStateful();
  const { wallet: walletInfo, account } = useWalletManager();
  const { transport, isAppOpen } = useLedgerTransport();

  if (!networkId || !walletInfo || !transport || !isAppOpen) {
    return undefined;
  }

  const flag = walletInfo.isLegacyWalletEnabled ?? false;
  const factoryFor = (isLegacy: boolean) =>
    isLegacy ? new LegacyAccountFactory() : new AccountFactory();

  // the signer and getAddress must derive from the same index, otherwise the
  // address shown to the user is not the key that signs
  const accountIndex = account?.index ?? 0;

  // The derivation whose key holds this account's funds; the flag alone can
  // name the other one (see resolveIsLegacy). Cached: no device exchange
  // between the signatures of a batch.
  const ledgerAccount = async () => {
    const isLegacy = account
      ? await resolveAccountIsLegacy(
          walletInfo.id,
          accountIndex,
          account.address,
          flag,
          networkId,
          async (legacy) =>
            (
              await factoryFor(legacy)
                .createFromLedger(transport, accountIndex)
                .getPublicKeys()
            )[0],
        )
      : flag;
    return factoryFor(isLegacy).createFromLedger(transport, accountIndex);
  };

  const getAddress = async () => {
    const publicKey = await (await ledgerAccount()).getPublicKey();
    const address = publicKey.toAddress(networkId).toString();
    return address;
  };

  return {
    getAddress,
    signTx: async (...args: Parameters<IWallet["signTx"]>) =>
      (await ledgerAccount()).signTx(...args),
    signInputDigest: async (...args: Parameters<IWallet["signInputDigest"]>) =>
      (await ledgerAccount()).signInputDigest(...args),
    getPublicKey: async () => (await ledgerAccount()).getPublicKey(),
    getPublicKeys: async () => (await ledgerAccount()).getPublicKeys(),
    signMessage: async (...args: Parameters<IWallet["signMessage"]>) =>
      (await ledgerAccount()).signMessage(...args),
  };
}
