import { createContext, ReactNode } from "react";
import useStorageState from "@/hooks/useStorageState.ts";
import Promise from "lie";

const RECENT_ADDRESSES_KEY = "local:recent-addresses";

export type RecentAddress = {
  kaspaAddress: string;
  usedAt: number;
  domain?: string;
};

const defaultValues: RecentAddressesContextType = {
  recentAddresses: [],
  addRecentAddress: () => Promise.resolve(),
};

type RecentAddressesContextType = {
  recentAddresses: RecentAddress[];
  addRecentAddress(recentAddress: RecentAddress): Promise<void>;
};

export const RecentAddressesContext =
  createContext<RecentAddressesContextType>(defaultValues);

export function RecentAddressesProvider({ children }: { children: ReactNode }) {
  const [recentAddresses, setRecentAddresses, isLoading] = useStorageState(
    RECENT_ADDRESSES_KEY,
    defaultValues.recentAddresses,
  );

  const addRecentAddress = async (recentAddress: RecentAddress) => {
    if (isLoading) {
      return;
    }

    recentAddresses.push(recentAddress);

    // Remove duplicated kaspaAddresses
    const uniqueAddresses = new Set();
    const uniqueRecentAddresses = recentAddresses.filter(
      ({ kaspaAddress }) =>
        !uniqueAddresses.has(kaspaAddress) && uniqueAddresses.add(kaspaAddress),
    );

    uniqueRecentAddresses.sort((a, b) => b.usedAt - a.usedAt);

    await setRecentAddresses(uniqueRecentAddresses);
  };

  return (
    <RecentAddressesContext.Provider
      value={
        isLoading
          ? defaultValues
          : {
              recentAddresses,
              addRecentAddress,
            }
      }
    >
      {children}
    </RecentAddressesContext.Provider>
  );
}
