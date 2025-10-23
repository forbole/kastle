import { createContext, ReactNode, useEffect, useState } from "react";
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
};

export const defaultValue = {
  lastLedgerNumber: 0,
  lastPrivateKeyNumber: 0,
  lastRecoveryPhraseNumber: 0,
  selectedAccountIndex: undefined,
  selectedWalletId: undefined,
  wallets: [],
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
  const { rpcClient, networkId } = useRpcClientStateful();
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

  // TODO: Remove this after the next release
  // Refresh public keys for the account that don't have them
  // NOTE: This is a temporary solution to fix the issue of missing public keys in old versions
  const generatePublicKeysForOldVersion = async (
    wallet: WalletInfo,
    accountIndex: number,
  ) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    const account = wallet.accounts.find((a) => a.index === accountIndex);
    if (!account) {
      return;
    }

    if (account.publicKeys?.length) {
      return;
    }

    switch (wallet?.type) {
      case "mnemonic":
        if (!account.publicKeys) {
          const { publicKeys } = await kaspaSigner.getPublicKeys({
            walletId: wallet.id,
            accountIndex: account.index,
          });

          account.publicKeys = publicKeys;
        }
        break;
      case "privateKey":
        if (!account.publicKeys) {
          const { publicKeys } = await kaspaSigner.getPublicKeys({
            walletId: wallet.id,
            accountIndex: account.index,
          });
          account.publicKeys = publicKeys;
        }
        break;
    }
  };

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

  const refreshAccounts = async () => {
    if (!networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    let isUpdated = false;

    for (const wallet of walletSettings.wallets) {
      for (const account of wallet.accounts) {
        // TODO: Remove this after the next release
        await generatePublicKeysForOldVersion(wallet, account.index);

        // hotfix for missing public keys
        if (!account.publicKeys?.length) {
          continue;
        }

        account.address = new PublicKey(account.publicKeys[0])
          .toAddress(networkId)
          .toString();
      }
    }

    if (!isUpdated) {
      return;
    }

    await setWalletSettings({
      ...walletSettings,
    });
  };

  // Refresh accounts after settings changed
  useEffect(() => {
    if (!rpcClient || isWalletSettingsLoading) {
      return;
    }

    refreshAccounts();
  }, [networkId, isWalletSettingsLoading]);

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
    if (!networkId || !account) {
      return;
    }

    // hotfix for missing public keys
    const missingPublicKeys = !account.publicKeys?.length;
    if (missingPublicKeys) {
      refreshAccounts();
      return;
    }

    const addressesToWatch = !account.publicKeys?.length
      ? [account.address]
      : account.publicKeys.map((publicKey) =>
          new PublicKey(publicKey).toAddress(networkId).toString(),
        );

    // skip if the addresses are the same
    if (addressesToWatch.join() === addresses.join()) {
      return;
    }

    setAddresses(addressesToWatch);
  }, [account, networkId]);

  useEffect(() => {
    if (!rpcClient || isWalletSettingsLoading || addresses.length === 0) {
      return;
    }

    const fetchBalance = async () => {
      const balance = (await getBalancesByAddresses(addresses)).toString();

      if (!account) {
        return;
      }

      setKaspaBalances((prev) => ({
        ...prev,
        [account.address]: parseFloat(balance),
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
      rpcClient.unsubscribeUtxosChanged(addresses);

      rpcClient.removeEventListener("utxos-changed", listenUtxosChanged);
    };
  }, [addresses, rpcClient, isWalletSettingsLoading]);

  // TODO: Remove this after the complete migration for users
  // Update accounts evm public key if it is not set
  useEffect(() => {
    if (!walletSettings || isWalletSettingsLoading) return;

    const tryUpdateEvmPublicKeys = async () => {
      let updated = false;
      const updatePromises = walletSettings.wallets.map(async (wallet) => {
        if (wallet.type === "ledger") return;
        const isEvmPublicKeySet = wallet.accounts.every(
          (account) => account.evmPublicKey !== undefined,
        );
        if (isEvmPublicKeySet) return;
        updated = true;

        await Promise.all(
          wallet.accounts.map(async (account) => {
            if (account.evmPublicKey !== undefined) return;

            const { publicKey } = await evmSigner.getPublicKey({
              walletId: wallet.id,
              accountIndex: account.index,
              isLegacy: false,
            });

            account.evmPublicKey = publicKey;
          }),
        );
      });
      await Promise.all(updatePromises);

      if (!updated) return;
      await setWalletSettings({ ...walletSettings });
    };

    tryUpdateEvmPublicKeys();
  }, [walletSettings, isWalletSettingsLoading]);

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
      }}
    >
      {children}
    </WalletManagerContext.Provider>
  );
}
