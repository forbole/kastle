import {
  createHashRouter,
  LoaderFunctionArgs,
  Navigate,
  Outlet,
  redirect,
} from "react-router-dom";
import PopupLayout from "@/components/layouts/PopupLayout.tsx";
import KasSend from "@/components/send/kas-send/KasSend";
import ConnectConfirm from "@/components/screens/browser-api/ConnectConfirm";
import SignAndBroadcastTxConfirm from "@/components/screens/browser-api/kaspa/SignAndBroadcastTxConfirm";
import Dashboard from "@/components/screens/Dashboard";
import Settings from "@/components/screens/Settings.tsx";
import Onboarding from "@/components/screens/Onboarding.tsx";
import AddWallet from "@/components/screens/AddWallet.tsx";
import ImportRecoveryPhrase from "@/components/screens/full-pages/ImportRecoveryPhrase";
import ImportPrivateKey from "@/components/screens/full-pages/ImportPrivateKey";
import ResetWallet from "@/components/screens/ResetWallet.tsx";
import FullscreenLayout from "@/components/layouts/FullscreenLayout.tsx";
import RecoveryPhraseManageAccounts from "@/components/screens/full-pages/RecoveryPhraseManageAccounts";
import RenameAccount from "@/components/screens/RenameAccount.tsx";
import ConnectedApps from "@/components/screens/ConnectedApps";
import RemoveWallet from "@/components/screens/RemoveWallet.tsx";
import AccountsImported from "@/components/screens/full-pages/AccountsImported";
import { getKeyringStatus } from "@/hooks/useKeyring.ts";
import ImportLedger from "@/components/screens/full-pages/ledger/ImportLedger";
import LedgerManageAccounts from "@/components/screens/full-pages/ledger/LedgerManageAccounts";
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
import Krc20Transfer from "@/components/send/krc20-send/Krc20Transfer";
import MintToken from "@/components/screens/full-pages/MintToken.tsx";
import TokenAsset from "@/components/screens/KRC20Asset";
import KasAsset from "@/components/screens/KasAsset.tsx";
import SignTxConfirm from "@/components/screens/browser-api/kaspa/SignTxConfirm";
import ConfirmMint from "@/components/screens/full-pages/ConfirmMint.tsx";
import MintingToken from "@/components/screens/full-pages/MintingToken.tsx";
import { TokenOperationFailed } from "@/components/screens/full-pages/TokenOperationFailed.tsx";
import { TokenOperationSuccess } from "@/components/screens/full-pages/TokenOperationSuccess.tsx";
import ConfirmDeploy from "@/components/screens/full-pages/ConfirmDeploy.tsx";
import DeployingToken from "@/components/screens/full-pages/DeployingToken.tsx";
import { RecentAddressesProvider } from "@/contexts/RecentAddressesContext.tsx";
import KNSAsset from "@/components/screens/KNSAsset";
import KRC721 from "@/components/screens/KRC721";
import OnboardingSuccess from "@/components/onboarding/OnboardingSuccess.tsx";
import ChangePassword from "@/components/screens/ChangePassword.tsx";
import EthereumSignMessageConfirm from "@/components/screens/browser-api/ethereum/EthereumSignMessageConfirm";
import EthereumSendTransactionConfirm from "@/components/screens/browser-api/ethereum/EthereumSendTransactionConfirm";
import BrowserAPILayout from "@/components/layouts/BrowserAPILayout";
import SignMessageConfirm from "@/components/screens/browser-api/kaspa/SignMessageConfirm";
import KNSTransfer from "@/components/screens/KNSTransfer.tsx";
import { KNSRecentTransferProvider } from "@/contexts/KNSRecentTransfer.tsx";
import { KRC721RecentTransferProvider } from "@/contexts/KRC721RecentTransfer.tsx";
import KRC721Transfer from "@/components/screens/KRC721Transfer.tsx";
import SwitchKaspaNetwork from "@/components/screens/browser-api/kaspa/SwitchKaspaNetwork";
import EthereumSignTypedDataV4 from "@/components/screens/browser-api/ethereum/EthereumSignTypedDataV4";
import KNSTextAsset from "@/components/screens/KNSTextAsset.tsx";
import SwitchEthereumNetwork from "@/components/screens/browser-api/ethereum/SwitchEthereumNetwork";
import EvmWatchAssetConfirm from "@/components/screens/browser-api/ethereum/EvmWatchAssetConfirm";
import Erc20Asset from "@/components/screens/Erc20Asset";
import { EVMAssetsProvider } from "@/contexts/EvmAssets";
import EvmKasAsset from "@/components/screens/EvmKasAsset";
import { Krc20Send } from "@/components/send/krc20-send/Krc20Send";
import EvmKasSend from "@/components/send/evm/evm-kas-send/EvmKasSend";
import Erc20Send from "@/components/send/evm/erc20-send/Erc20Send";
import SelectAddress from "@/components/screens/receive-addresses/SelectAddress";
import KaspaReceiveAddress from "@/components/screens/receive-addresses/KaspaReceiveAddress";
import EvmReceiveAddress from "@/components/screens/receive-addresses/EvmReceiveAddress";
import AssetSelect from "@/components/screens/asset-selector/AssetSelect";
import CommitRevealConfirm from "@/components/screens/browser-api/kaspa/CommitRevealConfirm";
import ShowWalletSecret from "@/components/screens/full-pages/show-wallet-secret/ShowWalletSecret";
import { KeyringStatusCheckerProvider } from "@/contexts/KeyringStatusChecker";
import { PostHogWrapperProvider } from "@/contexts/PostHogWrapperProvider.tsx";
import ERC721 from "@/components/screens/ERC721";

const loadKaspaWasm = async () => {
  await init({ module_or_path: kaspaModule });
  return null;
};

export const forceOnboarding = async () => {
  const url = new URL(browser.runtime.getURL("/popup.html"));
  const [tab] = await browser.tabs.query({
    url: url.toString(),
  });
  const previousTabId = tab?.id;

  if (previousTabId) {
    await chrome.tabs.update(previousTabId, { active: true });
    window.close();
  } else {
    url.hash = `/onboarding`;
    await browser.tabs.create({ url: url.toString() });
  }
};

const keyringGuard = async ({ request }: LoaderFunctionArgs) => {
  const keyringStatusResponse = await getKeyringStatus();

  if (!keyringStatusResponse.isInitialized) {
    await forceOnboarding();
    return null;
  }

  if (!keyringStatusResponse.isUnlocked) {
    const url = new URL(request.url);
    url.searchParams.set("redirect", url.pathname);
    url.pathname = "/unlock";

    return redirect(url.toString());
  }

  return null;
};

const browserAPIKeyringGuard = async ({ request }: LoaderFunctionArgs) => {
  const keyringStatusResponse = await getKeyringStatus();

  if (!keyringStatusResponse.isUnlocked) {
    const urlParams = new URLSearchParams(window.location.search);
    const url = new URL(request.url);
    url.searchParams.set("redirect", url.pathname);

    for (const param of urlParams.entries()) {
      url.searchParams.set(param[0], param[1]);
    }

    url.pathname = "/browser-api/unlock";

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
                  <KeyringStatusCheckerProvider>
                    <WalletManagerProvider>
                      <EVMAssetsProvider>
                        <PostHogWrapperProvider>
                          <Outlet />
                        </PostHogWrapperProvider>
                      </EVMAssetsProvider>
                    </WalletManagerProvider>
                  </KeyringStatusCheckerProvider>
                </RpcClientProvider>
              </RecentAddressesProvider>
            </SettingsProvider>
          </KaspaPriceProvider>
        ),
        loader: loadKaspaWasm,
        children: [
          {
            path: "unlock",
            element: <WalletUnlock />,
            loader: async () => {
              const keyringStatusResponse = await getKeyringStatus();

              if (!keyringStatusResponse.isInitialized) {
                await forceOnboarding();
                return null;
              }

              return null;
            },
          },
          {
            element: <PopupLayout />,
            children: [
              {
                index: true,
                element: <Navigate to="/dashboard" replace />,
              },
              {
                element: <Outlet />,
                loader: keyringGuard,
                children: [
                  // Sending
                  { path: "asset-select", element: <AssetSelect /> },
                  { path: "token-transfer", element: <Krc20Transfer /> },
                  { path: "kas/send", element: <KasSend /> },
                  { path: "krc20/send/:tick", element: <Krc20Send /> },
                  { path: "evm-kas/send/:chainId", element: <EvmKasSend /> },
                  {
                    path: "erc20/send/:chainId/:tokenId",
                    element: <Erc20Send />,
                  },

                  {
                    path: "kns-transfer/:assetId",
                    element: (
                      <KNSRecentTransferProvider>
                        <KNSTransfer />
                      </KNSRecentTransferProvider>
                    ),
                  },
                  {
                    path: "/krc721-transfer/:tick/:tokenId",
                    element: (
                      <KRC721RecentTransferProvider>
                        <KRC721Transfer />
                      </KRC721RecentTransferProvider>
                    ),
                  },
                  {
                    path: "receive/select-address",
                    element: <SelectAddress />,
                  },
                  { path: "receive/kaspa", element: <KaspaReceiveAddress /> },
                  {
                    path: "receive/evm/:chainId",
                    element: <EvmReceiveAddress />,
                  },
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
                    path: "change-password",
                    element: <ChangePassword />,
                  },
                  {
                    path: "token-asset/:ticker",
                    element: <TokenAsset />,
                  },
                  {
                    path: "kns/:assetId",
                    element: (
                      <KNSRecentTransferProvider>
                        <KNSAsset />
                      </KNSRecentTransferProvider>
                    ),
                  },
                  {
                    path: "kns-text/:assetId",
                    element: (
                      <KNSRecentTransferProvider>
                        <KNSTextAsset />
                      </KNSRecentTransferProvider>
                    ),
                  },
                  {
                    path: "krc721/:tick/:tokenId",
                    element: (
                      <KRC721RecentTransferProvider>
                        <KRC721 />
                      </KRC721RecentTransferProvider>
                    ),
                  },
                  {
                    path: "kas-asset",
                    element: <KasAsset />,
                  },

                  {
                    path: "erc20-asset/:chainId/:address",
                    element: <Erc20Asset />,
                  },
                  {
                    path: "evm-asset/:chainId",
                    element: <EvmKasAsset />,
                  },
                  {
                    path: "erc721/:chainId/:contractAddress/:tokenId",
                    element: <ERC721 />,
                  },
                ],
              },

              {
                element: <BrowserAPILayout />,
                children: [
                  {
                    path: "browser-api/unlock",
                    element: <WalletUnlock />,
                  },
                  {
                    element: <Outlet />,
                    loader: browserAPIKeyringGuard,
                    children: [
                      // Kaspa BrowserAPI routes
                      { path: "connect", element: <ConnectConfirm /> },
                      {
                        path: "sign-and-broadcast-tx",
                        element: <SignAndBroadcastTxConfirm />,
                      },
                      {
                        path: "sign-tx",
                        element: <SignTxConfirm />,
                      },
                      {
                        path: "sign-message",
                        element: <SignMessageConfirm />,
                      },
                      {
                        path: "/kaspa/switch-network",
                        element: <SwitchKaspaNetwork />,
                      },
                      {
                        path: "kaspa/commit-reveal",
                        element: <CommitRevealConfirm />,
                      },

                      // Ethereum BrowserAPI routes
                      {
                        path: "ethereum/sign-message",
                        element: <EthereumSignMessageConfirm />,
                      },
                      {
                        path: "ethereum/sign-typed-data-v4",
                        element: <EthereumSignTypedDataV4 />,
                      },
                      {
                        path: "ethereum/send-transaction",
                        element: <EthereumSendTransactionConfirm />,
                      },
                      {
                        path: "ethereum/switch-network",
                        element: <SwitchEthereumNetwork />,
                      },
                      {
                        path: "ethereum/watch-asset",
                        element: <EvmWatchAssetConfirm />,
                      },
                    ],
                  },
                ],
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
            element: <FullscreenLayout listenKeyring />,
            children: [
              {
                path: "wallet-locked-alert",
                element: <WalletLockedAlert />,
              },
              {
                path: "onboarding-success/:method",
                element: <OnboardingSuccess />,
              },
            ],
          },
          {
            element: <FullscreenLayout />,
            children: [
              {
                path: "onboarding",
                element: <Onboarding />,
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
                path: "show-wallet-secret/:walletId/:type",
                element: <ShowWalletSecret />,
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
