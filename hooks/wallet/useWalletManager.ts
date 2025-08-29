import { WalletManagerContext } from "@/contexts/WalletManagerContext.tsx";

export default function useWalletManager() {
  return useContext(WalletManagerContext);
}
