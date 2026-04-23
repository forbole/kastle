import useWalletManager from "../wallet/useWalletManager";
import { publicKeyToAddress } from "viem/accounts";
import { useSettings } from "../useSettings";
import { toLegacyEvmAddress } from "@/lib/utils";

export default function useEvmAddress() {
  const { account } = useWalletManager();
  const [settings] = useSettings();

  const isLegacyEvmEnabled = settings?.isLegacyEvmAddressEnabled ?? false;

  if (isLegacyEvmEnabled) {
    return account?.publicKeys && account.publicKeys.length > 0
      ? toLegacyEvmAddress(account.publicKeys[0])
      : undefined;
  }

  return account?.evmPublicKey
    ? publicKeyToAddress(account.evmPublicKey)
    : undefined;
}
