import {
  createHashRouter,
  LoaderFunctionArgs,
  Navigate,
  Outlet,
  redirect,
} from "react-router-dom";
import PopupLayout from "@/components/layouts/PopupLayout.tsx";
import SetupPassword from "@/components/screens/SetupPassword.tsx";
import Send from "@/components/screens/Send.tsx";
import Welcome from "@/components/screens/Welcome.tsx";
import ConnectConfirm from "@/components/screens/browser-api/ConnectConfirm";
import SignAndBroadcastTxConfirm from "@/components/screens/browser-api/SignAndBroadcastTxConfirm";
import Dashboard from "@/components/screens/Dashboard";
import Settings from "@/components/screens/Settings.tsx";
import Receive from "@/components/screens/Receive.tsx";
import Onboarding from "@/components/screens/Onboarding.tsx";
import AddWallet from "@/components/screens/AddWallet.tsx";
import ImportRecoveryPhrase from "@/components/screens/full-pages/ImportRecoveryPhrase";
import ImportPrivateKey from "@/components/screens/full-pages/ImportPrivateKey";
import ResetWallet from "@/components/screens/ResetWallet.tsx";
import FullscreenLayout from "@/components/layouts/FullscreenLayout.tsx";
import RecoveryPhraseManageAccounts from "@/components/screens/full-pages/RecoveryPhraseManageAccounts";
import ShowRecoveryPhrase from "@/components/screens/full-pages/ShowRecoveryPhrase";
import RenameAccount from "@/components/screens/RenameAccount.tsx";
import ConnectedApps from "@/components/screens/ConnectedApps";
import ShowPrivateKey from "@/components/screens/full-pages/ShowPrivateKey";
import RemoveWallet from "@/components/screens/RemoveWallet.tsx";
import BackupUnlock from "@/components/screens/BackupUnlock";
import AccountsImported from "@/components/screens/full-pages/AccountsImported";
import { getKeyringStatus } from "@/hooks/useKeyring.ts";
import ImportLedger from "@/components/screens/full-pages/ledger/ImportLedger";
import LedgerManageAccounts from "@/components/screens/full-pages/ledger/LedgerManageAccounts";
import LedgerConnect from "@/components/screens/full-pages/ledger/LedgerConnectForImport";
import WalletLockedAlert from "@/components/screens/full-pages/WalletLockedAlert";
import init from "@/wasm/core/kaspa";
import kaspaModule from "@/assets/kaspa_bg.wasm?url";
import { KaspaPriceProvider } from "@/contexts/KaspaPriceContext.tsx";
import { RpcClientProvider } from "@/contexts/RpcClientContext.tsx";
import { SettingsProvider } from "@/contexts/SettingsContext.tsx";
import { WalletManagerProvider } from "@/contexts/WalletManagerContext.tsx";
import RootLayout from "@/components/layouts/RootLayout.tsx";
import WalletUnlock from "@/components/screens/WalletUnlock.tsx";
import DevMode from "@/components/screens/DevMode.tsx";
import DeployToken from "@/components/screens/full-pages/DeployToken.tsx";
import TokenTransfer from "@/components/screens/TokenTransfer.tsx";
import MintToken from "@/components/screens/full-pages/MintToken.tsx";
import TokenAsset from "@/components/screens/TokenAsset.tsx";
import KasAsset from "@/components/screens/KasAsset.tsx";
import SignTxConfirm from "@/components/screens/browser-api/SignTxConfirm";
import ConfirmMint from "@/components/screens/full-pages/ConfirmMint.tsx";
import MintingToken from "@/components/screens/full-pages/MintingToken.tsx";
import { TokenOperationFailed } from "@/components/screens/full-pages/TokenOperationFailed.tsx";
import { TokenOperationSuccess } from "@/components/screens/full-pages/TokenOperationSuccess.tsx";
import ConfirmDeploy from "@/components/screens/full-pages/ConfirmDeploy.tsx";
import DeployingToken from "@/components/screens/full-pages/DeployingToken.tsx";
import { RecentAddressesProvider } from "@/contexts/RecentAddressesContext.tsx";
import LedgerConnectForImportFailed from "@/components/screens/full-pages/ledger/LedgerConnectForImportFailed";
import LedgerConnectForSign from "@/components/screens/ledger-connect/LedgerConnectForSign";
import LedgerConnectForSignFailed from "@/components/screens/ledger-connect/LedgerConnectForSignFailed";
import KNSAsset from "@/components/screens/KNSAsset";

const loadKaspaWasm = async () => {
  await init(kaspaModule);
  return null;
};

const keyringGuard = async ({ request }: LoaderFunctionArgs) => {
  const keyringStatusResponse = await getKeyringStatus();

  if (!keyringStatusResponse.isInitialized) {
    return redirect("/onboarding");
  }

  if (!keyringStatusResponse.isUnlocked) {
    const url = new URL(request.url);
    url.searchParams.set("redirect", url.pathname);
    url.pathname = "/unlock";

    return redirect(url.toString());
  }

  return null;
};

const fullPageKeyringGuard = async ({ request }: LoaderFunctionArgs) => {
  const keyringStatusResponse = await getKeyringStatus();

  if (
    !keyringStatusResponse.isUnlocked ||
    !keyringStatusResponse.isInitialized
  ) {
    const url = new URL(request.url);
    url.searchParams.set("redirect", url.pathname);
    url.pathname = "/wallet-locked-alert";

    return redirect(url.toString());
  }

  return null;
};

export const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: (
          <KaspaPriceProvider>
            <SettingsProvider>
              <RecentAddressesProvider>
                <RpcClientProvider>
                  <WalletManagerProvider>
                    <Outlet />
                  </WalletManagerProvider>
                </RpcClientProvider>
              </RecentAddressesProvider>
            </SettingsProvider>
          </KaspaPriceProvider>
        ),
        loader: loadKaspaWasm,
        children: [
          {
            element: <PopupLayout />,
            children: [
              {
                path: "unlock",
                element: <WalletUnlock />,
                loader: async () => {
                  const keyringStatusResponse = await getKeyringStatus();

                  if (!keyringStatusResponse.isInitialized) {
                    return redirect("/onboarding");
                  }

                  return null;
                },
              },
              {
                index: true,
                element: <Navigate to="/dashboard" replace />,
              },
              {
                element: <Outlet />,
                loader: keyringGuard,
                children: [
                  { path: "send", element: <Send /> },
                  { path: "token-transfer", element: <TokenTransfer /> },
                  { path: "receive", element: <Receive /> },
                  { path: "settings", element: <Settings /> },
                  {
                    path: "connected-apps",
                    element: <ConnectedApps />,
                  },
                  {
                    path: "dev-mode",
                    element: <DevMode />,
                  },
                  { path: "dashboard", element: <Dashboard /> },
                  { path: "add-wallet", element: <AddWallet /> },
                  {
                    path: "rename-account/:walletId/:accountIndex",
                    element: <RenameAccount />,
                  },
                  {
                    path: "remove-wallet/:walletId",
                    element: <RemoveWallet />,
                  },
                  {
                    path: "backup-unlock",
                    element: <BackupUnlock />,
                  },
                  {
                    path: "token-asset/:ticker",
                    element: <TokenAsset />,
                  },
                  {
                    path: "kns/:assetId",
                    element: <KNSAsset />,
                  },
                  {
                    path: "kas-asset",
                    element: <KasAsset />,
                  },
                  {
                    path: "ledger-connect-for-sign",
                    element: <LedgerConnectForSign />,
                  },
                  {
                    path: "ledger-connect-for-sign-failed",
                    element: <LedgerConnectForSignFailed />,
                  },

                  // Browser API routes
                  { path: "connect", element: <ConnectConfirm /> },
                  {
                    path: "sign-and-broadcast-tx",
                    element: <SignAndBroadcastTxConfirm />,
                  },
                  {
                    path: "sign-tx",
                    element: <SignTxConfirm />,
                  },
                ],
              },
              {
                path: "onboarding",
                element: <Onboarding />,
              },
              {
                path: "setup",
                element: <SetupPassword />,
              },
              {
                path: "success",
                element: <Welcome />,
              },
              { path: "password-lost", element: <ResetWallet /> },
              {
                // Catch all unknown routes
                path: "*",
                element: <Navigate to="/dashboard" replace />,
              },
            ],
          },
          {
            element: <FullscreenLayout />,
            children: [
              {
                path: "wallet-locked-alert",
                element: <WalletLockedAlert />,
              },
            ],
          },
          {
            element: <FullscreenLayout />,
            children: [
              {
                path: "manage-accounts/recovery-phrase/:walletId/:action",
                element: <RecoveryPhraseManageAccounts />,
              },
              {
                path: "manage-accounts/ledger/:walletId/:action",
                element: <LedgerManageAccounts />,
              },
              {
                path: "import-recovery-phrase",
                element: <ImportRecoveryPhrase />,
              },
              { path: "import-private-key", element: <ImportPrivateKey /> },
              {
                path: "show-recovery-phrase/:walletId",
                element: <ShowRecoveryPhrase />,
              },
              {
                path: "show-private-key/:walletId/:accountIndex",
                element: <ShowPrivateKey />,
              },
              {
                path: "accounts-imported",
                element: <AccountsImported />,
              },
              {
                path: "import-ledger",
                element: <ImportLedger />,
              },
              {
                path: "ledger-connect-for-import",
                element: <LedgerConnect />,
              },
              {
                path: "ledger-connect-for-import-failed",
                element: <LedgerConnectForImportFailed />,
              },
              {
                path: "deploy-token",
                element: <DeployToken />,
              },
              {
                path: "confirm-deploy",
                element: <ConfirmDeploy />,
              },
              {
                path: "deploying-token",
                element: <DeployingToken />,
              },
              {
                path: "mint-token",
                element: <MintToken />,
              },
              {
                path: "confirm-mint",
                element: <ConfirmMint />,
              },
              {
                path: "minting-token",
                element: <MintingToken />,
              },
              {
                path: "token-operation-failed",
                element: <TokenOperationFailed />,
              },
              {
                path: "token-operation-success",
                element: <TokenOperationSuccess />,
              },
            ],
            loader: fullPageKeyringGuard,
          },
        ],
      },
    ],
  },
]);
