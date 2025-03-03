import { RecentAddressesContext } from "@/contexts/RecentAddressesContext.tsx";

export default function useRecentAddresses() {
  return useContext(RecentAddressesContext);
}
