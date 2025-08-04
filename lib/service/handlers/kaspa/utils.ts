import {
  WalletSettings,
  WALLET_SETTINGS,
  defaultValue,
} from "@/contexts/WalletManagerContext";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/wallet/account-factory";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { WalletSecret } from "@/types/WalletSecret";

async function getWalletSettings() {
  return await storage.getItem<WalletSettings>(WALLET_SETTINGS, {
    fallback: defaultValue,
  });
}

async function isWalletLegacyEnabled(walletId: string) {
  const walletSettings = await getWalletSettings();
  const currentWallet = walletSettings.wallets.find(
    (wallet) => wallet.id === walletId,
  );
  return currentWallet?.isLegacyWalletEnabled ?? true;
}

async function getAccountFactory(
  isLegacy: boolean,
): Promise<AccountFactory | LegacyAccountFactory> {
  return isLegacy ? new LegacyAccountFactory() : new AccountFactory();
}

export async function getCurrentSigner(walletId: string, accountIndex: number) {
  const isLegacy = await isWalletLegacyEnabled(walletId);
  return getSigner(walletId, accountIndex, isLegacy);
}

export async function getSigner(
  walletId: string,
  accountIndex: number,
  isLegacy: boolean,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const walletSecrets = await keyring.getValue<WalletSecret[]>("wallets");
  const walletSecret = walletSecrets?.find((w) => w.id === walletId);
  if (!walletSecret) {
    throw new Error(`Unable to find wallet secret for wallet ID ${walletId}`);
  }

  const factory = await getAccountFactory(isLegacy);

  switch (walletSecret.type) {
    case "privateKey":
      return factory.createFromPrivateKey(walletSecret.value);

    case "mnemonic":
      return factory.createFromMnemonic(walletSecret.value, accountIndex);

    default:
      throw new Error(`Unsupported wallet type: ${walletSecret.type}`);
  }
}
