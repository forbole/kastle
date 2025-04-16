import { KRC721RecentTransferContext } from "@/contexts/KRC721RecentTransfer.tsx";

export default function useKRC721RecentTransfer() {
  return useContext(KRC721RecentTransferContext);
}
