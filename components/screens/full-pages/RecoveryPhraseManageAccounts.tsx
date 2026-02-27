import React, { useState } from "react";
import ManageAccounts, {
  ListAccountsRequest,
} from "@/components/screens/full-pages/account-management/ManageAccounts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useParams } from "react-router-dom";
import Splash from "../Splash";
import useKaspaBackgroundSigner from "@/hooks/wallet/useKaspaBackgroundSigner";
import useEvmBackgroundSigner from "@/hooks/wallet/useEvmBackgroundSigner";
import { useSettings } from "@/hooks/useSettings";

export default function RecoveryPhraseManageAccounts() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { walletId } = useParams();
  const { walletSettings } = useWalletManager();
  const wallet = walletSettings?.wallets.find(({ id }) => id === walletId);
  const kaspaSigner = useKaspaBackgroundSigner();
  const evmSigner = useEvmBackgroundSigner();
  const [settings] = useSettings();

  const [isLegacyEnabled, setIsLegacyEnabled] = useState(
    wallet?.isLegacyWalletEnabled ?? true,
  );

  const listAccounts =
    rpcClient && networkId
      ? async ({ walletId, start, end }: ListAccountsRequest) => {
          if (!rpcClient) return [];

          const accounts = [];
          for (let i = start; i < end; i++) {
            const { publicKeys } = await kaspaSigner.getPublicKeys({
              walletId,
              accountIndex: i,
              isLegacy: isLegacyEnabled,
            });

            // When legacy features is disabled, force non-legacy EVM address
            const shouldUseLegacy = settings?.isLegacyFeaturesEnabled
              ? (settings?.isLegacyEvmAddressEnabled ?? false)
              : false;

            const { publicKey: evmPublicKey } = await evmSigner.getPublicKey({
              walletId,
              accountIndex: i,
              isLegacy: shouldUseLegacy,
              isKastleLegacy: isLegacyEnabled,
            });

            accounts.push({ publicKeys, evmPublicKey });
          }

          return accounts;
        }
      : undefined;

  return (
    <>
      {!wallet && <Splash />}
      {wallet && (
        <ManageAccounts
          key={`manage-accounts-${isLegacyEnabled}-${settings?.isLegacyFeaturesEnabled}-${settings?.isLegacyEvmAddressEnabled ?? false}`}
          wallet={wallet}
          listAccounts={listAccounts}
          isLegacyWalletEnabled={isLegacyEnabled}
          toggleLegacyWallet={() => setIsLegacyEnabled((prev) => !prev)}
        />
      )}
    </>
  );
}
