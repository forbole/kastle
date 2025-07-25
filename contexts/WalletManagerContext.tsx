import { createContext, ReactNode, useEffect, useState } from "react";
import { WalletSecretType } from "@/types/WalletSecret.ts";
import useKeyring from "@/hooks/useKeyring.ts";
import { AccountFactory as KaspaAccountFactory } from "@/lib/wallet/wallet-factory.ts";
import { AccountFactory as EvmAccountFactory } from "@/lib/ethereum/wallet/account-factory.ts";
import { EthereumPrivateKeyAccount } from "@/lib/ethereum/wallet/account/private-key-account.ts";
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

export const WALLET_SETTINGS = "local:wallet-settings";

export type Account = {
  index: number;
  name: string;
  balance: string | undefined;
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
  createNewWallet(id: string, defaultAccountName?: string): Promise<void>;
  removeWallet: (walletId: string) => Promise<{ noWallet: boolean }>;
  addAccount: (walletId: string, select?: boolean | undefined) => Promise<void>;
  selectAccount: (
    walletId: string,
    accountIndex?: number | undefined,
  ) => Promise<void>;
  importWalletByLedger: (
    id: string,
    deviceId: string,
    publicKeys: string[],
    defaultAccountName?: string,
  ) => Promise<void>;
  importWalletByMnemonic: (
    id: string,
    mnemonic: string,
    defaultAccountName?: string,
    backed?: boolean,
  ) => Promise<void>;
  importPrivateKey: (id: string, privateKey: string) => Promise<void>;
  resetWallet: () => Promise<void>;
  renameAccount: ({
    name,
    walletId,
    accountIndex,
  }: {
    name: string;
    walletId: string;
    accountIndex: number;
  }) => Promise<void>;
  updateSelectedAccounts: ({
    walletId,
    accounts,
  }: {
    walletId: string;
    accounts: Record<string, { publicKeys: string[]; active: boolean }>;
  }) => Promise<void>;
  getPrivateKey: ({
    walletId,
    accountIndex,
  }: {
    walletId: string;
    accountIndex: number;
  }) => Promise<string>;
  markWalletBacked: (walletId: string) => Promise<void>;
  getBalancesByAddresses: (addresses: string[]) => Promise<number>;
  renameWallet: (walletId: string, newName: string) => Promise<void>;
};

const defaultValue = {
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
  addAccount: defaultAsyncFunction,
  getPrivateKey: defaultAsyncFunction,
  importPrivateKey: defaultAsyncFunction,
  importWalletByLedger: defaultAsyncFunction,
  importWalletByMnemonic: defaultAsyncFunction,
  markWalletBacked: defaultAsyncFunction,
  removeWallet: defaultAsyncFunction,
  renameAccount: defaultAsyncFunction,
  resetWallet: defaultAsyncFunction,
  selectAccount: defaultAsyncFunction,
  updateSelectedAccounts: defaultAsyncFunction,
  createNewWallet: defaultAsyncFunction,
  getBalancesByAddresses: defaultAsyncFunction,
  renameWallet: defaultAsyncFunction,
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

  const createNewWallet = async (id: string, defaultAccountName?: string) => {
    const mnemonic = KaspaAccountFactory.generateMnemonic();
    await importWalletByMnemonic(id, mnemonic, defaultAccountName, false);
  };

  const importWalletByMnemonic = async (
    id: string,
    mnemonic: string,
    defaultAccountName = "Account 0",
    backed = true,
  ) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and network ID not loaded");
    }

    const kaspaWallet = new KaspaAccountFactory(
      rpcClient,
      networkId,
    ).createFromMnemonic(mnemonic, 0);

    const evmWallet = EvmAccountFactory.createFromMnemonic(mnemonic, 0);

    await keyring.addWalletSecret({
      id,
      type: "mnemonic",
      value: mnemonic,
    });

    await addWallet({
      id,
      type: "mnemonic",
      name: `Recovery phrase ${++walletSettings.lastRecoveryPhraseNumber}`,
      accounts: [
        {
          index: 0,
          name: defaultAccountName,
          balance: "0",
          address: await kaspaWallet.getAddress(),
          publicKeys: await kaspaWallet.getPublicKeys(),
          evmPublicKey: await evmWallet.getPublicKey(),
        },
      ],
      backed,
    });
  };

  const importWalletByLedger = async (
    id: string,
    deviceId: string,
    publicKeys: string[],
    defaultAccountName = "Account 0",
  ) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    // Save new wallet to keyring
    await keyring.addWalletSecret({
      id,
      type: "ledger",
      value: deviceId,
    });

    if (!walletSettings.lastLedgerNumber) {
      walletSettings.lastLedgerNumber = 0;
    }

    await addWallet({
      id,
      type: "ledger",
      name: `Ledger ${++walletSettings.lastLedgerNumber}`,
      accounts: [
        {
          index: 0,
          name: defaultAccountName,
          balance: "0",
          address: new PublicKey(publicKeys[0]).toAddress(networkId).toString(),
          publicKeys: publicKeys,
        },
      ],
      backed: true,
    });
  };

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

    const { walletSecret } = await keyring.getWalletSecret({
      walletId: wallet.id,
    });
    const accountFactory = new KaspaAccountFactory(rpcClient, networkId);

    switch (wallet?.type) {
      case "mnemonic":
        if (!account.publicKeys) {
          const hotWallet = accountFactory.createFromMnemonic(
            walletSecret.value,
            account.index,
          );
          account.publicKeys = await hotWallet.getPublicKeys();
        }
        break;
      case "privateKey":
        if (!account.publicKeys) {
          const hotWallet = accountFactory.createFromPrivateKey(
            walletSecret.value,
          );
          account.publicKeys = await hotWallet.getPublicKeys();
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

  const addWallet = async (
    wallet: WalletInfo,
    select: boolean | undefined = true,
  ) => {
    const alreadyExist = walletSettings.wallets.find((w) => w.id === wallet.id);

    if (alreadyExist) {
      throw new Error(`Wallet ${wallet.id} already exists`);
    }

    walletSettings.wallets.push(wallet);

    if (select) {
      walletSettings.selectedWalletId = wallet.id;
      walletSettings.selectedAccountIndex = 0;
    }

    await setWalletSettings(walletSettings);
  };

  const removeWallet = async (walletId: string) => {
    walletSettings.wallets = walletSettings.wallets.filter(
      (w) => w.id !== walletId,
    );

    const noWallet = walletSettings.wallets.length === 0;

    if (noWallet) {
      await resetWallet();
      return { noWallet: noWallet };
    }

    await keyring.removeWalletSecret({ walletId });

    // If the wallet being removed is the selected wallet, select the first account of the first wallet
    if (walletSettings.selectedWalletId === walletId) {
      walletSettings.selectedWalletId = walletSettings.wallets[0]?.id;
      walletSettings.selectedAccountIndex =
        walletSettings.wallets[0]?.accounts[0]?.index;
    }

    await setWalletSettings(walletSettings);

    return { noWallet: noWallet };
  };

  const addAccount = async (
    walletId: string,
    select: boolean | undefined = false,
  ) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    const wallet = walletSettings.wallets.find((w) => walletId === w.id);

    if (!wallet) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    const lastAccount = wallet.accounts[wallet.accounts.length - 1];
    const nextIndex = lastAccount.index + 1;

    const { walletSecret } = await keyring.getWalletSecret({ walletId });

    const newAccount = new KaspaAccountFactory(
      rpcClient,
      networkId,
    ).createFromMnemonic(walletSecret.value, nextIndex);

    const newEvmAccount = EvmAccountFactory.createFromMnemonic(
      walletSecret.value,
      nextIndex,
    );

    wallet.accounts.push({
      address: await newAccount.getAddress(),
      balance: undefined,
      name: `Account ${nextIndex}`,
      index: nextIndex,
      publicKeys: await newAccount.getPublicKeys(),
      evmPublicKey: await newEvmAccount.getPublicKey(),
    });

    if (select) {
      walletSettings.selectedAccountIndex = nextIndex;
    }

    await setWalletSettings(walletSettings);
  };

  const selectAccount = async (
    walletId: string,
    accountIndex: number | undefined = undefined,
  ) => {
    walletSettings.selectedWalletId = walletId;

    if (accountIndex !== undefined) {
      walletSettings.selectedAccountIndex = accountIndex;
    }

    await setWalletSettings(walletSettings);
  };

  const updateSelectedAccounts = async ({
    walletId,
    accounts,
  }: {
    walletId: string;
    accounts: Record<string, { publicKeys: string[]; active: boolean }>;
  }) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    const wallet = walletSettings.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    let updatedAccounts = wallet.accounts;

    // Filtering out accounts set to false
    updatedAccounts = updatedAccounts.filter((a) => accounts[`${a.index}`]);

    // Adding selected accounts
    Object.entries(accounts).forEach(([index, value]) => {
      if (value.active) {
        const indexNumber = parseInt(index, 10);
        const account = updatedAccounts.find((a) => a.index === indexNumber);

        // Account already active
        if (account) {
          return;
        }

        updatedAccounts.push({
          index: indexNumber,
          name: `Account ${indexNumber}`,
          balance: undefined,
          address: new PublicKey(value.publicKeys[0])
            .toAddress(networkId)
            .toString(),
          publicKeys: value.publicKeys,
        });
      }
    });

    // Prevent no accounts in wallet
    if (updatedAccounts.length === 0) {
      throw new Error("Oops! Please select at least one account to proceed.");
    }

    // Sort accounts by index
    updatedAccounts.sort((a, b) => a.index - b.index);

    const isSelectedAccountRemoved =
      wallet.id === walletSettings.selectedWalletId &&
      !updatedAccounts.find(
        (a) => a.index === walletSettings.selectedAccountIndex,
      );

    // Selected account is not in the list then select the first account
    if (
      walletSettings.selectedAccountIndex === null ||
      isSelectedAccountRemoved
    ) {
      walletSettings.selectedAccountIndex = updatedAccounts[0].index;
    }

    // Update accounts
    wallet.accounts = updatedAccounts;

    await setWalletSettings(walletSettings);
  };

  const renameAccount = async ({
    name,
    walletId,
    accountIndex,
  }: {
    name: string;
    walletId: string;
    accountIndex: number;
  }) => {
    const account = walletSettings.wallets
      .find((w) => w.id === walletId)
      ?.accounts?.find((a) => a.index === accountIndex);

    if (!account) {
      throw new Error("Account not found");
    }

    account.name = name;

    await setWalletSettings(walletSettings);
    await selectAccount(walletId, accountIndex);
  };

  const getPrivateKey = async ({
    walletId,
    accountIndex,
  }: {
    walletId: string;
    accountIndex: number;
  }) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }
    const { walletSecret } = await keyring.getWalletSecret({ walletId });

    if (walletSecret.type === "mnemonic") {
      const hotWallet = new KaspaAccountFactory(
        rpcClient,
        networkId,
      ).createFromMnemonic(walletSecret.value, accountIndex);

      return hotWallet.getPrivateKeyString();
    } else {
      return walletSecret.value;
    }
  };

  const importPrivateKey = async (id: string, privateKey: string) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    await keyring.addWalletSecret({
      id,
      type: "privateKey",
      value: privateKey,
    });

    const kaspaWallet = new KaspaAccountFactory(
      rpcClient,
      networkId,
    ).createFromPrivateKey(privateKey);

    await addWallet({
      id,
      type: "privateKey",
      name: `Private key ${++walletSettings.lastPrivateKeyNumber}`,
      accounts: [
        {
          index: 0,
          name: "Account 0",
          balance: undefined,
          address: await kaspaWallet.getAddress(),
          publicKeys: await kaspaWallet.getPublicKeys(),
          evmPublicKey: await new EthereumPrivateKeyAccount(
            privateKey,
          ).getPublicKey(),
        },
      ],
      backed: true,
    });

    await setWalletSettings(walletSettings);
  };

  const markWalletBacked = async (walletId: string) => {
    const wallet = walletSettings.wallets.find((w) => w.id === walletId);

    if (!wallet) {
      throw new Error("Wallet not found");
    }

    wallet.backed = true;

    await setWalletSettings(walletSettings);
  };

  const resetWallet = async () => {
    await setWalletSettings(defaultValue);
    await keyring.keyringReset();
  };

  const refreshAccounts = async () => {
    if (!networkId) {
      throw new Error("RPC client and settings not loaded");
    }

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
        account.balance = undefined;
      }
    }

    await setWalletSettings(walletSettings);
  };

  const renameWallet = async (walletId: string, newName: string) => {
    const wallet = walletSettings.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      return;
    }

    wallet.name = newName;

    await setWalletSettings({
      ...walletSettings,
      wallets: [...walletSettings.wallets],
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
      const currentAccount = getCurrentAccount(walletSettings);

      if (!currentAccount) {
        return;
      }
      currentAccount.balance = balance;

      await setWalletSettings(walletSettings);
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
        const { walletSecret } = await keyring.getWalletSecret({
          walletId: wallet.id,
        });
        await Promise.all(
          wallet.accounts.map(async (account) => {
            if (account.evmPublicKey !== undefined) return;
            switch (walletSecret.type) {
              case "mnemonic": {
                const evmAccount = EvmAccountFactory.createFromMnemonic(
                  walletSecret.value,
                  account.index,
                );
                account.evmPublicKey = await evmAccount.getPublicKey();
                break;
              }
              case "privateKey": {
                const evmPrivateKeyAccount = new EthereumPrivateKeyAccount(
                  walletSecret.value,
                );
                account.evmPublicKey =
                  await evmPrivateKeyAccount.getPublicKey();
                break;
              }
            }
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
        walletSettings: isWalletSettingsLoading ? undefined : walletSettings,
        createNewWallet,
        removeWallet,
        addAccount,
        selectAccount,
        importWalletByLedger,
        importWalletByMnemonic,
        importPrivateKey,
        resetWallet,
        renameAccount,
        updateSelectedAccounts,
        getPrivateKey,
        markWalletBacked,
        getBalancesByAddresses,
        renameWallet,
      }}
    >
      {children}
    </WalletManagerContext.Provider>
  );
}
