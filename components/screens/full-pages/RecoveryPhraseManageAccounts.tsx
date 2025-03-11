import React from "react";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import ManageAccounts, {
  ListAccountsRequest,
} from "@/components/screens/full-pages/account-management/ManageAccounts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

export default function RecoveryPhraseManageAccounts() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { getWalletSecret } = useKeyring();

  const listAccounts =
    rpcClient && networkId
      ? async ({ walletId, start, end }: ListAccountsRequest) => {
          if (!rpcClient) return [];

          const accountFactory = new AccountFactory(rpcClient, networkId);
          const { walletSecret } = await getWalletSecret({ walletId });

          if (!walletSecret || walletSecret.type !== "mnemonic") {
            throw new Error("Only mnemonic wallets are supported on this page");
          }

          const accounts = await Promise.all(
            Array.from({ length: end - start }, (_, i) =>
              accountFactory
                .createFromMnemonic(walletSecret.value, start + i)
                .getPublicKeys(),
            ),
          );

          return accounts.map((publicKeys) => ({ publicKeys }));
        }
      : undefined;

  return <ManageAccounts walletType="mnemonic" listAccounts={listAccounts} />;
}
