import { AccountFactory as KaspaAccountFactory } from "@/lib/wallet/account-factory";
import { AccountFactory as EvmAccountFactory } from "@/lib/ethereum/wallet/account-factory";
import { EthereumPrivateKeyAccount } from "@/lib/ethereum/wallet/account/private-key-account";
import { PublicKey } from "@/wasm/core/kaspa";
import { WalletInfo } from "@/contexts/WalletManagerContext";

import useRpcClientStateful from "../useRpcClientStateful";
import useWalletManager from "./useWalletManager";
import useKeyring from "../useKeyring";

export default function useWalletImporter() {
  const keyring = useKeyring();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { walletSettings, setWalletSettings } = useWalletManager();

  const addWallet = async (
    wallet: WalletInfo,
    select: boolean | undefined = true,
  ) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");

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

  const importWalletByMnemonic = async (
    id: string,
    mnemonic: string,
    defaultAccountName = "Account 0",
    backed = true,
  ) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");
    if (!rpcClient || !networkId)
      throw new Error("RPC client and network ID not loaded");

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
    if (!walletSettings) throw new Error("Wallet manager not initialized");
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

  const importWalletByPrivateKey = async (id: string, privateKey: string) => {
    if (!walletSettings) throw new Error("Wallet manager not initialized");
    if (!rpcClient || !networkId)
      throw new Error("RPC client and settings not loaded");

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

  const createNewWallet = async (id: string, defaultAccountName?: string) => {
    const mnemonic = KaspaAccountFactory.generateMnemonic();
    await importWalletByMnemonic(id, mnemonic, defaultAccountName, false);
  };

  return {
    importWalletByMnemonic,
    importWalletByLedger,
    importWalletByPrivateKey,
    createNewWallet,
    addWallet,
  };
}
