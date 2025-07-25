import React, { useState } from "react";
import { LegacyAccountFactory } from "@/lib/wallet/account-factory";
import ManageAccounts, {
  ListAccountsRequest,
} from "@/components/screens/full-pages/account-management/ManageAccounts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { useSettings } from "@/hooks/useSettings";
import {
  AccountFactory as EvmAccountFactory,
  LegacyAccountFactory as EvmLegacyAccountFactory,
} from "@/lib/ethereum/wallet/account-factory";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useParams } from "react-router-dom";
import Splash from "../Splash";

export default function RecoveryPhraseManageAccounts() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { getWalletSecret } = useKeyring();
  const [settings] = useSettings();

  const { walletId } = useParams();
  const { walletSettings } = useWalletManager();
  const wallet = walletSettings?.wallets.find(({ id }) => id === walletId);

  const [isLegacyEnabled, setIsLegacyEnabled] = useState(
    wallet?.isLegacyWalletEnabled ?? true,
  );

  const listAccounts =
    rpcClient && networkId
      ? async ({ walletId, start, end }: ListAccountsRequest) => {
          if (!rpcClient) return [];

          const accountFactory = new LegacyAccountFactory(rpcClient, networkId);
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

  return (
    <>
      {!wallet && <Splash />}
      {wallet && (
        <ManageAccounts
          key={`manage-accounts-${isLegacyEnabled}`}
          wallet={wallet}
          listAccounts={listAccounts}
          isLegacyWalletEnabled={isLegacyEnabled}
          toggleLegacyWallet={() => setIsLegacyEnabled((prev) => !prev)}
        />
      )}
    </>
  );
}
