import { createContext, ReactNode, useEffect, useRef, useState } from "react";
import { WalletSecretType } from "@/types/WalletSecret.ts";
import useKeyring from "@/hooks/useKeyring.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import useStorageState from "@/hooks/useStorageState.ts";
import {
  IUtxosChanged,
  PublicKey,
  sompiToKaspaString,
  UtxoEntryReference,
} from "@/wasm/core/kaspa";
import internalToast from "@/components/Toast.tsx";
import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import useKaspaBackgroundSigner from "@/hooks/wallet/useKaspaBackgroundSigner";
import useEvmBackgroundSigner from "@/hooks/wallet/useEvmBackgroundSigner";
import { NetworkType } from "./SettingsContext";
import { useSettings } from "@/hooks/useSettings";
import {
  WALLET_SETTINGS_VERSION,
  migrateWalletSettings,
} from "@/lib/migrations/wallet-settings";

export const WALLET_SETTINGS = "local:wallet-settings";
const KASPA_BALANCES_KEY = "local:kaspa-balances";

export type Account = {
  index: number;
  name: string;
  address: string;
  publicKeys?: string[];
  evmPublicKey?: `0x${string}`;
};

export type WalletInfo = {
  id: string;
  type: WalletSecretType;
  name: string;
  accounts: Account[];
  backed: boolean;

  isLegacyWalletEnabled?: boolean;
};

export type WalletSettings = {
  selectedWalletId: string | undefined;
  selectedAccountIndex: number | undefined;
  wallets: WalletInfo[];
  lastRecoveryPhraseNumber: number;
  lastPrivateKeyNumber: number;
  lastLedgerNumber?: number;
  version?: number;
};

type WalletManagerContextType = {
  walletSettings?: WalletSettings;
  wallet: WalletInfo | undefined;
  account: Account | undefined;
  addresses: string[];
  kaspaBalances: Record<string, number>;
  setWalletSettings: (
    settings: WalletSettings | ((prev: WalletSettings) => WalletSettings),
  ) => Promise<void>;
  resetWallet: () => Promise<void>;
  markWalletBacked: (walletId: string) => Promise<void>;
  getBalancesByAddresses: (addresses: string[]) => Promise<number>;
  refreshKaspaAddresses: (networkId: NetworkType) => Promise<void>;
};

export const defaultValue = {
  lastLedgerNumber: 0,
  lastPrivateKeyNumber: 0,
  lastRecoveryPhraseNumber: 0,
  selectedAccountIndex: undefined,
  selectedWalletId: undefined,
  wallets: [],
  version: 1,
} satisfies WalletSettings;

const defaultAsyncFunction = () =>
  Promise.reject("Wallet manager not initialized");

export const WalletManagerContext = createContext<WalletManagerContextType>({
  walletSettings: undefined,
  wallet: undefined,
  account: undefined,
  addresses: [],
  kaspaBalances: {},
  setWalletSettings: defaultAsyncFunction,
  markWalletBacked: defaultAsyncFunction,
  resetWallet: defaultAsyncFunction,
  getBalancesByAddresses: defaultAsyncFunction,
  refreshKaspaAddresses: defaultAsyncFunction,
});

const getCurrentWalletInfo = (walletSettings: WalletSettings) => {
  if (walletSettings.selectedWalletId === null) {
    return;
  }

  return walletSettings.wallets.find(
    (w) => w.id === walletSettings.selectedWalletId,
  );
};

const getCurrentAccount = (walletSettings: WalletSettings) => {
  if (walletSettings.selectedAccountIndex === null) {
    return;
  }

  const currentWalletInfo = getCurrentWalletInfo(walletSettings);

  return currentWalletInfo?.accounts.find(
    (a) => a.index === walletSettings.selectedAccountIndex,
  );
};

export function WalletManagerProvider({ children }: { children: ReactNode }) {
  const keyring = useKeyring();
  const { rpcClient } = useRpcClientStateful();
  const [walletSettings, setWalletSettings, isWalletSettingsLoading] =
    useStorageState<WalletSettings>(WALLET_SETTINGS, defaultValue);
  const [wallet, setWallet] = useState<WalletInfo>();
  const [account, setAccount] = useState<Account>();
  const [addresses, setAddresses] = useState<string[]>([]);
  const [kaspaBalances, setKaspaBalances] = useStorageState<
    Record<string, number>
  >(KASPA_BALANCES_KEY, {});
  const kaspaSigner = useKaspaBackgroundSigner();
  const evmSigner = useEvmBackgroundSigner();
  const [settings] = useSettings();
  const networkId = settings?.networkId;
  const isMigratingRef = useRef(false);

  const getBalancesByAddresses = async (
    addresses: string[],
  ): Promise<number> => {
    if (!rpcClient) {
      throw new Error("RPC client not loaded");
    }

    const { entries } = await rpcClient.getBalancesByAddresses(addresses);
    const balance = entries.reduce((acc, curr) => acc + curr.balance, 0n);

    return parseFloat(sompiToKaspaString(balance ?? 0n).replaceAll(",", ""));
  };

  const markWalletBacked = async (walletId: string) => {
    const wallet = walletSettings.wallets.find((w) => w.id === walletId);

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    wallet.backed = true;

    await setWalletSettings({ ...walletSettings });
  };

  const resetWallet = async () => {
    await setWalletSettings(defaultValue);
    await keyring.keyringReset();
  };

  const refreshKaspaAddresses = async (networkId: NetworkType) => {
    let isUpdated = false;
    const wallets = walletSettings?.wallets;
    if (!wallets) {
      return;
    }

    for (const wallet of wallets) {
      for (const account of wallet.accounts) {
        // hotfix for missing public keys
        if (!account.publicKeys?.length) {
          continue;
        }

        account.address = new PublicKey(account.publicKeys[0])
          .toAddress(networkId)
          .toString();

        isUpdated = true;
      }
    }

    if (!isUpdated) {
      return;
    }

    await setWalletSettings((prev) => ({ ...prev, wallets: wallets }));
  };

  // Refresh wallet and account after settings changed
  useEffect(() => {
    if (!networkId || isWalletSettingsLoading) {
      return;
    }

    const currentWalletInfo = getCurrentWalletInfo(walletSettings);
    const currentAccount = getCurrentAccount(walletSettings);
    if (currentWalletInfo && currentWalletInfo !== wallet) {
      setWallet(currentWalletInfo);
    }

    if (currentAccount && currentAccount !== account) {
      setAccount(currentAccount);
    }
  }, [walletSettings, networkId, isWalletSettingsLoading]);

  useEffect(() => {
    if (!networkId || !account || !wallet) {
      return;
    }

    // In legacy mode, watch all addresses derived from publicKeys
    // In non-legacy mode, only watch the primary account.address
    const addressesToWatch =
      wallet.isLegacyWalletEnabled && account.publicKeys?.length
        ? account.publicKeys.map((publicKey) =>
            new PublicKey(publicKey).toAddress(networkId).toString(),
          )
        : [account.address];

    // skip if the addresses are the same
    if (addressesToWatch.join() === addresses.join()) {
      return;
    }

    setAddresses(addressesToWatch);
  }, [account, wallet, networkId]);

  useEffect(() => {
    if (
      !rpcClient ||
      isWalletSettingsLoading ||
      addresses.length === 0 ||
      !account ||
      !networkId
    ) {
      return;
    }

    // Capture the current account address to avoid race conditions
    const currentAccountAddress = account.address;
    let cancelled = false;

    const fetchBalance = async () => {
      const balance = await getBalancesByAddresses(addresses);

      // Don't update if this fetch was cancelled
      if (cancelled) {
        return;
      }

      setKaspaBalances((prev) => ({
        ...prev,
        [currentAccountAddress]: balance,
      }));
    };

    function checkIncomingUtxos(event: {
      added: UtxoEntryReference[];
      removed: UtxoEntryReference[];
    }) {
      if (event.added.length === 0 || !networkId) {
        return;
      }

      const txId = event.added[0].outpoint.transactionId;
      const explorerTxLink = explorerTxLinks[networkId];
      const outgoingAmount = event.removed.reduce(
        (acc, curr) =>
          addresses.includes(curr.address?.toString() ?? "")
            ? acc + curr.amount
            : acc,
        0n,
      );
      const incomingAmount = event.added.reduce(
        (acc, curr) =>
          addresses.includes(curr.address?.toString() ?? "")
            ? acc + curr.amount
            : acc,
        0n,
      );
      const transferAmount = incomingAmount - outgoingAmount;
      if (transferAmount <= 0) {
        return;
      }

      internalToast.info(
        `You’ve received ${sompiToKaspaString(transferAmount)} KAS. Click to open on explorer`,
        () => browser.tabs.create({ url: `${explorerTxLink}${txId}` }),
        txId,
      );
    }

    const listenUtxosChanged = async (event: IUtxosChanged) => {
      await fetchBalance();
      checkIncomingUtxos(event.data);
    };

    fetchBalance();

    rpcClient.addEventListener("utxos-changed", listenUtxosChanged);

    rpcClient.subscribeUtxosChanged(addresses);
    return () => {
      cancelled = true;
      rpcClient.unsubscribeUtxosChanged(addresses);

      rpcClient.removeEventListener("utxos-changed", listenUtxosChanged);
    };
  }, [addresses, rpcClient, isWalletSettingsLoading, networkId]);

  // Migration: Generate missing keys (first time or old version upgrade)
  // This migration runs only once when version is not set or less than current version
  useEffect(() => {
    if (!walletSettings || isWalletSettingsLoading || !networkId) return;

    // Skip if already migrated to current version
    if (
      walletSettings.version &&
      walletSettings.version >= WALLET_SETTINGS_VERSION
    ) {
      return;
    }

    // Critical: Ensure all required services are ready before migration
    if (!kaspaSigner || !evmSigner) {
      return;
    }

    // Prevent concurrent execution
    if (isMigratingRef.current) {
      return;
    }

    isMigratingRef.current = true;

    const runMigration = async (prev: WalletSettings) => {
      try {
        const result = await migrateWalletSettings(prev, {
          kaspaSigner,
          evmSigner,
          settings,
          networkId,
        });
        return result;
      } catch (error) {
        // Keep original state and retry on next dependency change
        return prev;
      } finally {
        isMigratingRef.current = false;
      }
    };

    setWalletSettings(runMigration);
  }, [isWalletSettingsLoading, networkId, kaspaSigner, evmSigner, settings]);

  // 2. Handle EVM legacy address toggle (only update EVM public key when isLegacyEvmAddressEnabled changes)
  useEffect(() => {
    if (!walletSettings || isWalletSettingsLoading || !networkId) return;

    // Wait for migration to complete first
    if (!walletSettings.version || isMigratingRef.current) return;

    const updateEvmPublicKeys = async (prev: WalletSettings) => {
      const wallets = prev.wallets;
      if (!wallets) return prev;

      let updated = false;
      const newWallets = await Promise.all(
        wallets.map(async (wallet) => {
          if (wallet.type === "ledger") return wallet;

          const isKastleLegacy = wallet.isLegacyWalletEnabled ?? false;
          const shouldUseLegacy = settings?.isLegacyEvmAddressEnabled ?? false;

          const newAccounts = await Promise.all(
            wallet.accounts.map(async (account) => {
              // Generate EVM public key with current settings
              const { publicKey: evmPublicKey } = await evmSigner.getPublicKey({
                walletId: wallet.id,
                accountIndex: account.index,
                isLegacy: shouldUseLegacy,
                isKastleLegacy,
              });

              // Check if EVM public key actually changed
              if (account.evmPublicKey !== evmPublicKey) {
                updated = true;
              }

              return {
                ...account,
                evmPublicKey,
              };
            }),
          );

          return { ...wallet, accounts: newAccounts };
        }),
      );

      if (!updated) return prev;
      return { ...prev, wallets: newWallets };
    };

    setWalletSettings(updateEvmPublicKeys);
  }, [isWalletSettingsLoading, settings?.isLegacyEvmAddressEnabled, networkId]);

  // 4. Update Kaspa addresses when network changes (mainnet ↔ testnet)
  useEffect(() => {
    if (!walletSettings || isWalletSettingsLoading || !networkId) return;

    // Wait for migration to complete first
    if (!walletSettings.version || isMigratingRef.current) return;

    const updateKaspaAddresses = async (prev: WalletSettings) => {
      const wallets = prev.wallets;
      if (!wallets) return prev;

      let updated = false;
      const newWallets = wallets.map((wallet) => {
        const newAccounts = wallet.accounts.map((account) => {
          if (!account.publicKeys?.length) return account;

          const expectedAddress = new PublicKey(account.publicKeys[0])
            .toAddress(networkId)
            .toString();

          if (account.address === expectedAddress) return account;

          updated = true;
          return {
            ...account,
            address: expectedAddress,
          };
        });

        return { ...wallet, accounts: newAccounts };
      });

      if (!updated) return prev;
      return { ...prev, wallets: newWallets };
    };

    setWalletSettings(updateKaspaAddresses);
  }, [isWalletSettingsLoading, networkId]);

  return (
    <WalletManagerContext.Provider
      value={{
        wallet,
        account,
        addresses,
        kaspaBalances,
        walletSettings: isWalletSettingsLoading ? undefined : walletSettings,
        setWalletSettings,
        resetWallet,
        markWalletBacked,
        getBalancesByAddresses,
        refreshKaspaAddresses,
      }}
    >
      {children}
    </WalletManagerContext.Provider>
  );
}
