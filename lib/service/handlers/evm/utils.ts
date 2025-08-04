import { ExtensionService } from "../../extension-service";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/ethereum/wallet/account-factory";
import { WalletSecret } from "@/types/WalletSecret";

export async function getSigner(
  walletId: string,
  accountIndex: number,
  isLegacy: boolean = true,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const accountFactory = isLegacy
    ? new LegacyAccountFactory()
    : new AccountFactory();

  const walletSecrets = await keyring.getValue<WalletSecret[]>("wallets");
  const walletSecret = walletSecrets?.find((w) => w.id === walletId);
  if (!walletSecret) {
    throw new Error(`Unable to find wallet secret for wallet ID ${walletId}`);
  }

  switch (walletSecret.type) {
    case "privateKey":
      return accountFactory.createFromPrivateKey(walletSecret.value);
    case "mnemonic":
      return accountFactory.createFromMnemonic(
        walletSecret.value,
        accountIndex,
      );
    default:
      throw new Error(`Unsupported wallet secret type: ${walletSecret.type}`);
  }
}
