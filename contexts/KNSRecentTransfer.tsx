import { createContext, ReactNode } from "react";
import useWalletManager from "@/hooks/wallet/useWalletManager";

const RECENT_KNS_TRANSFER = "session:recent-kns-transfer";

type RecentKNSTransfer = {
  id: string;
  from: string;
  at: number;
};

const defaultValues: KNSRecentTransferContextType = {
  isRecentKNSTransfer: () => true,
  addRecentKNSTransfer: () => Promise.resolve(),
};

type KNSRecentTransferContextType = {
  isRecentKNSTransfer: (assetId: string) => boolean;
  addRecentKNSTransfer: (transfer: RecentKNSTransfer) => Promise<void>;
};

const THIRTY_SECONDS_IN_MS = 30 * 1000;

export const KNSRecentTransferContext =
  createContext<KNSRecentTransferContextType>(defaultValues);

export function KNSRecentTransferProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { account } = useWalletManager();
  const [recentKnsTransfer, setRecentKnsTransfer, isLoading] = useStorageState<
    Array<RecentKNSTransfer>
  >(RECENT_KNS_TRANSFER, []);

  const addRecentKNSTransfer = async (transfer: RecentKNSTransfer) => {
    if (isLoading) return;

    const recentTransfer = recentKnsTransfer.filter((transfer) => {
      const isRecent =
        new Date().getTime() - new Date(transfer.at).getTime() <
        THIRTY_SECONDS_IN_MS;

      return isRecent;
    });
    recentTransfer.push(transfer);

    await setRecentKnsTransfer(recentTransfer);
  };

  const isRecentKNSTransfer = (assetId: string) => {
    return !!recentKnsTransfer.find((transfer) => {
      const sameAssetId = assetId === transfer.id;
      const sameOriginAddress = transfer.from === account?.address;
      const isRecent =
        new Date().getTime() - new Date(transfer.at).getTime() <
        THIRTY_SECONDS_IN_MS;

      return sameAssetId && sameOriginAddress && isRecent;
    });
  };

  return (
    <KNSRecentTransferContext.Provider
      value={
        isLoading
          ? defaultValues
          : {
              addRecentKNSTransfer,
              isRecentKNSTransfer,
            }
      }
    >
      {children}
    </KNSRecentTransferContext.Provider>
  );
}
