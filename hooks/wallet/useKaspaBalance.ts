import useWalletManager from "./useWalletManager";

export default function useKaspaBalance(address?: string) {
  const { kaspaBalances } = useWalletManager();
  return address ? (kaspaBalances[address.toString()] ?? 0) : undefined;
}
