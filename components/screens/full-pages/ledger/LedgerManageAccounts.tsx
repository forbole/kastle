import React, { useRef } from "react";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import ManageAccounts, {
  ListAccountsRequest,
} from "@/components/screens/full-pages/account-management/ManageAccounts";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate } from "react-router-dom";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

export default function LedgerManageAccounts() {
  const navigate = useNavigate();
  const { transport } = useLedgerTransport();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { getWalletSecret } = useKeyring();
  const calledOnce = useRef(false);

  const listAccounts =
    rpcClient && networkId
      ? async ({ walletId, start, end }: ListAccountsRequest) => {
          if (!transport) return [];

          const accountFactory = new AccountFactory(rpcClient, networkId);

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

  useEffect(() => {
    if (!transport && !calledOnce.current) {
      const currentUrl = window.location.hash.replace("#", "");
      navigate("/ledger-connect-for-import?redirect=" + currentUrl);
    }
  }, [transport]);

  return <ManageAccounts walletType="ledger" listAccounts={listAccounts} />;
}
