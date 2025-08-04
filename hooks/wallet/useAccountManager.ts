import {
  LegacyAccountFactory as KaspaLegacyAccountFactory,
  AccountFactory as KaspaAccountFactory,
} from "@/lib/wallet/account-factory";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { PublicKey } from "@/wasm/core/kaspa";
import useKeyring from "@/hooks/useKeyring";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBackgroundSigner from "./useKaspaBackgroundSigner";
import useEvmBackgroundSigner from "./useEvmBackgroundSigner";
import { useSettings } from "../useSettings";

export default function useAccountManager() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const { walletSettings, setWalletSettings } = useWalletManager();
  const keyring = useKeyring();
  const kaspaBackgroundSigner = useKaspaBackgroundSigner();
  const evmBackgroundSigner = useEvmBackgroundSigner();
  const [settings] = useSettings();

  // Function to add a new account to the wallet
  const addAccount = async (
    walletId: string,
    select: boolean | undefined = false,
  ) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }
    if (!walletSettings) {
      throw new Error("Wallet manager not initialized");
    }

    const wallet = walletSettings.wallets.find((w) => walletId === w.id);

    if (!wallet) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    const lastAccount = wallet.accounts[wallet.accounts.length - 1];
    const nextIndex = lastAccount.index + 1;

    const walletIsLegacy = wallet.isLegacyWalletEnabled ?? true;

    const { publicKeys: kaspaPublicKeys } =
      await kaspaBackgroundSigner.getPublicKeys({
        walletId,
        accountIndex: nextIndex,
        isLegacy: walletIsLegacy,
      });
    const kaspaAddress = new PublicKey(kaspaPublicKeys[0])
      .toAddress(networkId)
      .toString();

    const { publicKey: evmPublicKey } = await evmBackgroundSigner.getPublicKey({
      walletId,
      accountIndex: nextIndex,
      isLegacy: settings?.isLegacyEvmAddressEnabled ?? false,
    });

    wallet.accounts.push({
      address: kaspaAddress,
      balance: undefined,
      name: `Account ${nextIndex}`,
      index: nextIndex,
      publicKeys: kaspaPublicKeys,
      evmPublicKey,
    });

    if (select) {
      walletSettings.selectedAccountIndex = nextIndex;
    }

    await setWalletSettings(walletSettings);
  };

  // Function to select an account in the wallet
  const selectAccount = async (
    walletId: string,
    accountIndex: number | undefined = undefined,
  ) => {
    if (!walletSettings) {
      throw new Error("Wallet manager not initialized");
    }

    walletSettings.selectedWalletId = walletId;

    if (accountIndex !== undefined) {
      walletSettings.selectedAccountIndex = accountIndex;
    }

    await setWalletSettings(walletSettings);
  };

  // Function to update selected accounts in the wallet
  const updateSelectedAccounts = async ({
    walletId,
    accounts,
  }: {
    walletId: string;
    accounts: Record<
      string,
      {
        address: string;
        publicKeys: string[];
        evmPublicKey?: `0x${string}`;
        active: boolean;
      }
    >;
  }) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }
    if (!walletSettings) {
      throw new Error("Wallet manager not initialized");
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
          account.publicKeys = value.publicKeys;
          account.address = value.address;
          account.evmPublicKey = value.evmPublicKey;
          account.balance = undefined;
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

  // Function to rename an account in the wallet
  const renameAccount = async ({
    name,
    walletId,
    accountIndex,
  }: {
    name: string;
    walletId: string;
    accountIndex: number;
  }) => {
    if (!walletSettings) {
      throw new Error("Wallet manager not initialized");
    }

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

  const getAccountPrivateKey = async ({
    walletId,
    password,
  }: {
    walletId: string;
    accountIndex: number;
    password: string;
  }) => {
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }
    if (!walletSettings) {
      throw new Error("Wallet manager not initialized");
    }

    const { walletSecret } = await keyring.getWalletSecret({
      walletId,
      password,
    });

    const wallet = walletSettings.wallets.find((w) => w.id === walletId);
    if (!wallet) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    const isLegacyEnabled = wallet.isLegacyWalletEnabled ?? true; // Default to true if not specified
    const factory = isLegacyEnabled
      ? new KaspaLegacyAccountFactory()
      : new KaspaAccountFactory();

    if (walletSecret.type !== "privateKey") {
      throw new Error("Cannot get private key from mnemonic wallet");
    } else {
      return walletSecret.value;
    }
  };

  return {
    addAccount,
    selectAccount,
    updateSelectedAccounts,
    renameAccount,
    getAccountPrivateKey,
  };
}
