import useLedgerTransport from "@/hooks/useLedgerTransport";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "./useWalletManager";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/wallet/account-factory";

export default function useKaspaLedgerSigner() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { wallet: walletInfo } = useWalletManager();
  const { transport, isAppOpen } = useLedgerTransport();

  if (!rpcClient || !networkId || !walletInfo || !transport || !isAppOpen) {
    return null;
  }

  const isLegacyEnabled = walletInfo.isLegacyWalletEnabled ?? true; // Default to true if not specified
  const factory = isLegacyEnabled
    ? new LegacyAccountFactory(rpcClient, networkId)
    : new AccountFactory(rpcClient, networkId);

  return factory.createFromLedger(transport);
}
