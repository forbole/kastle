import useWalletManager from "../wallet/useWalletManager";
import { publicKeyToAddress } from "viem/accounts";

export default function useEvmAddress() {
  const { account } = useWalletManager();

  const evmAddressFromEvm = account?.evmPublicKey
    ? publicKeyToAddress(account.evmPublicKey)
    : undefined;

  return evmAddressFromEvm;
}
