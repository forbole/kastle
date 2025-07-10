import useWalletManager from "../useWalletManager";
import { toEvmAddressFromKaspaPublicKey } from "@/lib/utils";
import { useSettings } from "../useSettings";
import { publicKeyToAddress } from "viem/accounts";

export default function useEvmAddress() {
  const { account } = useWalletManager();
  const [settings] = useSettings();

  const evmAddressFromKaspa = account?.publicKeys?.[0]
    ? toEvmAddressFromKaspaPublicKey(account.publicKeys[0])
    : undefined;
  const evmAddressFromEvm = account?.evmPublicKey
    ? publicKeyToAddress(account.evmPublicKey)
    : undefined;

  return settings?.isLegacyEvmAddress ? evmAddressFromKaspa : evmAddressFromEvm;
}
