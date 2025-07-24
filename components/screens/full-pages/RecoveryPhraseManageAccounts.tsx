import React from "react";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import ManageAccounts, {
  ListAccountsRequest,
} from "@/components/screens/full-pages/account-management/ManageAccounts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { useSettings } from "@/hooks/useSettings";
import {
  AccountFactory as EvmAccountFactory,
  LegacyAccountFactory as EvmLegacyAccountFactory,
} from "@/lib/ethereum/wallet/account-factory";

export default function RecoveryPhraseManageAccounts() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { getWalletSecret } = useKeyring();
  const [settings] = useSettings();

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

          return await Promise.all(
            accounts.map(async (publicKeys, index) => ({
              publicKeys,
              evmPublicKey: settings?.isLegacyEvmAddressEnabled
                ? await EvmLegacyAccountFactory.createFromMnemonic(
                    walletSecret.value,
                    start + index,
                  ).getAddress()
                : await EvmAccountFactory.createFromMnemonic(
                    walletSecret.value,
                    start + index,
                  ).getAddress(),
            })),
          );
        }
      : undefined;

  return <ManageAccounts walletType="mnemonic" listAccounts={listAccounts} />;
}
