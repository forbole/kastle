import useWalletManager from "../useWalletManager";
import { toLegacyEvmAddress } from "@/lib/utils";
import { useSettings } from "../useSettings";
import { publicKeyToAddress } from "viem/accounts";

export default function useEvmAddress() {
  const { account } = useWalletManager();
  const [settings] = useSettings();

  const evmAddressFromKaspa = account?.publicKeys?.[0]
    ? toLegacyEvmAddress(account.publicKeys[0])
    : undefined;
  const evmAddressFromEvm = account?.evmPublicKey
    ? publicKeyToAddress(account.evmPublicKey)
    : undefined;

  return settings?.isLegacyEvmAddressEnabled
    ? evmAddressFromKaspa
    : evmAddressFromEvm;
}
