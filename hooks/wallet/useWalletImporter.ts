import { AccountFactory as KaspaAccountFactory } from "@/lib/wallet/account-factory";
import { AccountFactory as EvmAccountFactory } from "@/lib/ethereum/wallet/account-factory";
import { EthereumPrivateKeyAccount } from "@/lib/ethereum/wallet/account/private-key-account";
import { PublicKey } from "@/wasm/core/kaspa";
import {
  WALLET_SETTINGS,
  WalletInfo,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import type { WalletSecret } from "@/types/WalletSecret";
import { updateWalletSettingsLocked } from "@/lib/wallet-settings-storage";

import useRpcClientStateful from "../useRpcClientStateful";
import useWalletManager from "./useWalletManager";
import useKeyring from "../useKeyring";

export default function useWalletImporter() {
  const keyring = useKeyring();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { walletSettings } = useWalletManager();

  const addWallet = async (
    wallet: WalletInfo,
    secret: WalletSecret,
    select: boolean | undefined = true,
  ) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");
    await updateWalletSettingsLocked<WalletSettings>(
      WALLET_SETTINGS,
      async (current) => {
        if (wallet.type === "zkasSeed")
          throw new Error("Use the ZKas seed importer for this wallet");
        if (wallet.id !== secret.id || wallet.type !== secret.type) {
          throw new Error("Wallet secret does not match its public wallet");
        }
        if (current.wallets.some((existing) => existing.id === wallet.id)) {
          throw new Error(`Wallet ${wallet.id} already exists`);
        }
        await keyring.addWalletSecret(secret);
        const numberKey =
          wallet.type === "mnemonic"
            ? "lastRecoveryPhraseNumber"
            : wallet.type === "privateKey"
              ? "lastPrivateKeyNumber"
              : "lastLedgerNumber";
        const number = (current[numberKey] ?? 0) + 1;
        const name =
          wallet.type === "mnemonic"
            ? `Recovery phrase ${number}`
            : wallet.type === "privateKey"
              ? `Private key ${number}`
              : `Ledger ${number}`;
        return {
          ...current,
          [numberKey]: number,
          wallets: [...current.wallets, { ...wallet, name }],
          selectedWalletId: select ? wallet.id : current.selectedWalletId,
          selectedAccountIndex: select ? 0 : current.selectedAccountIndex,
        };
      },
    );
  };

  const importWalletByMnemonic = async (
    id: string,
    mnemonic: string,
    defaultAccountName = "Account 0",
    backed = true,
    passphrase?: string,
  ) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");
    if (!rpcClient || !networkId)
      throw new Error("RPC client and network ID not loaded");

    const kaspaWallet = new KaspaAccountFactory().createFromMnemonic(
      mnemonic,
      0,
      passphrase,
    );

    const address = (await kaspaWallet.getPublicKey())
      .toAddress(networkId)
      .toString();
    const evmWallet = new EvmAccountFactory().createFromMnemonic(
      mnemonic,
      0,
      false,
      passphrase,
    );

    await addWallet(
      {
        id,
        type: "mnemonic",
        name: "Recovery phrase",
        isLegacyWalletEnabled: false,
        accounts: [
          {
            index: 0,
            name: defaultAccountName,
            address,
            publicKeys: await kaspaWallet.getPublicKeys(),
            evmPublicKey: await evmWallet.getPublicKey(),
          },
        ],
        backed,
      },
      { id, type: "mnemonic", value: mnemonic, passphrase },
    );

    return address;
  };

  const importWalletByLedger = async (
    id: string,
    deviceId: string,
    publicKeys: string[],
    defaultAccountName = "Account 0",
  ) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");
    if (!rpcClient || !networkId) {
      throw new Error("RPC client and settings not loaded");
    }

    const address = new PublicKey(publicKeys[0])
      .toAddress(networkId)
      .toString();

    await addWallet(
      {
        id,
        type: "ledger",
        name: "Ledger",
        isLegacyWalletEnabled: false,
        accounts: [
          {
            index: 0,
            name: defaultAccountName,
            address,
            publicKeys: publicKeys,
          },
        ],
        backed: true,
      },
      { id, type: "ledger", value: deviceId },
    );

    return address;
  };

  const importWalletByPrivateKey = async (id: string, privateKey: string) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");
    if (!rpcClient || !networkId)
      throw new Error("RPC client and settings not loaded");

    const kaspaWallet = new KaspaAccountFactory().createFromPrivateKey(
      privateKey,
    );

    const address = (await kaspaWallet.getPublicKey())
      .toAddress(networkId)
      .toString();

    await addWallet(
      {
        id,
        type: "privateKey",
        name: "Private key",
        isLegacyWalletEnabled: false,
        accounts: [
          {
            index: 0,
            name: "Account 0",
            address,
            publicKeys: await kaspaWallet.getPublicKeys(),
            evmPublicKey: await new EthereumPrivateKeyAccount(
              privateKey,
            ).getPublicKey(),
          },
        ],
        backed: true,
      },
      { id, type: "privateKey", value: privateKey },
    );

    return address;
  };

  const createNewWallet = async (id: string, defaultAccountName?: string) => {
    const mnemonic = KaspaAccountFactory.generateMnemonic();
    return importWalletByMnemonic(
      id,
      mnemonic,
      defaultAccountName,
      false,
      undefined,
    );
  };

  return {
    importWalletByMnemonic,
    importWalletByLedger,
    importWalletByPrivateKey,
    createNewWallet,
    addWallet,
  };
}
