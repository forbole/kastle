import {
  AccountFactory,
  LegacyAccountFactory,
  LegacyWasmAccountFactory,
  LegacyWasmLegacyAccountFactory,
} from "@/lib/wallet/account-factory";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { WalletSecret } from "@/types/WalletSecret";

async function getAccountFactory(
  isLegacy: boolean,
  networkId?: string,
): Promise<
  | AccountFactory
  | LegacyAccountFactory
  | LegacyWasmAccountFactory
  | LegacyWasmLegacyAccountFactory
> {
  if (networkId === "mainnet") {
    return isLegacy
      ? new LegacyWasmLegacyAccountFactory()
      : new LegacyWasmAccountFactory();
  }
  return isLegacy ? new LegacyAccountFactory() : new AccountFactory();
}

export async function getSigner(
  walletId: string,
  accountIndex: number,
  isLegacy: boolean,
  networkId?: string,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const walletSecrets = await keyring.getValue<WalletSecret[]>("wallets");
  const walletSecret = walletSecrets?.find((w) => w.id === walletId);
  if (!walletSecret) {
    throw new Error(`Unable to find wallet secret for wallet ID ${walletId}`);
  }

  const factory = await getAccountFactory(isLegacy, networkId);

  switch (walletSecret.type) {
    case "privateKey":
      return factory.createFromPrivateKey(walletSecret.value);

    case "mnemonic":
      return factory.createFromMnemonic(walletSecret.value, accountIndex);

    default:
      throw new Error(`Unsupported wallet type: ${walletSecret.type}`);
  }
}
