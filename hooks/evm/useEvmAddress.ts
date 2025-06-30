import useWalletManager from "../useWalletManager";
import { toEvmAddress } from "@/lib/utils";

export default function useEvmAddress() {
  const { account } = useWalletManager();
  const publicKey = account?.publicKeys?.[0];

  // Convert the public key to an EVM address
  const evmAddress = publicKey ? toEvmAddress(publicKey) : undefined;
  return evmAddress;
}
