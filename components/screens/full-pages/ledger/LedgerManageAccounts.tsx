import {
  LegacyAccountFactory,
  AccountFactory,
} from "@/lib/wallet/account-factory";
import ManageAccounts, {
  ListAccountsRequest,
} from "@/components/screens/full-pages/account-management/ManageAccounts";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate } from "react-router-dom";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import LedgerConnectForImport from "@/components/screens/full-pages/ledger/LedgerConnectForImport";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKeyring from "@/hooks/useKeyring";
import { useParams } from "react-router-dom";
import Splash from "../../Splash";
import { useState } from "react";

export default function LedgerManageAccounts() {
  const navigate = useNavigate();
  const { transport, isAppOpen } = useLedgerTransport();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { getWalletSecret } = useKeyring();
  const { walletSettings } = useWalletManager();
  const { walletId } = useParams();
  const wallet = walletSettings?.wallets.find(({ id }) => id === walletId);

  const [isLegacyEnabled, setIsLegacyEnabled] = useState(
    wallet?.isLegacyWalletEnabled ?? true,
  );

  const listAccounts =
    rpcClient && networkId
      ? async ({ walletId, start, end }: ListAccountsRequest) => {
          if (!transport) return [];

          const accountFactory = isLegacyEnabled
            ? new LegacyAccountFactory(rpcClient, networkId)
            : new AccountFactory(rpcClient, networkId);

          const { walletSecret } = await getWalletSecret({ walletId });
          if (walletSecret.type !== "ledger") {
            throw new Error("Only ledger wallets are supported on this page");
          }

          // Check if the wallet is connected to the correct device
          const deviceId = walletSecret.value;
          const ledgerAccount = accountFactory.createFromLedger(transport);
          const publicKeys = await ledgerAccount.getPublicKeys();
          if (deviceId !== publicKeys[0]) {
            throw new Error("Unmatched wallet and device");
          }
          try {
            const accounts: { publicKeys: string[] }[] = [];

            for (let i = start; i < end; i++) {
              const account = accountFactory.createFromLedger(transport, i);
              accounts.push({
                publicKeys: await account.getPublicKeys(),
              });
            }

            return accounts;
          } catch (error) {
            navigate("/ledger-connect-for-import-failed");
            throw new Error(
              "Failed to list accounts, please unlock and open Kaspa app and try again",
            );
          }
        }
      : undefined;

  return (
    <>
      {!wallet && <Splash />}
      {wallet && (!transport || !isAppOpen) && (
        <LedgerConnectForImport onBack={() => {}} />
      )}
      {wallet && transport && isAppOpen && (
        <ManageAccounts
          key={wallet.id + wallet.isLegacyWalletEnabled}
          wallet={wallet}
          listAccounts={listAccounts}
          isLegacyWalletEnabled={isLegacyEnabled}
          toggleLegacyWallet={() => setIsLegacyEnabled((prev) => !prev)}
        />
      )}
    </>
  );
}
