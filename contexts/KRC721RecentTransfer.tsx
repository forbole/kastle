import { createContext, ReactNode } from "react";

const RECENT_KRC721_TRANSFER = "session:recent-krc721-transfer";

type RecentKRC721Transfer = {
  id: string;
  from: string;
  at: number;
};

const defaultValues: KRC721RecentTransferContextType = {
  isRecentKRC721Transfer: () => true,
  addRecentKRC721Transfer: () => Promise.resolve(),
};

type KRC721RecentTransferContextType = {
  isRecentKRC721Transfer: (tokenId: string) => boolean;
  addRecentKRC721Transfer: (transfer: RecentKRC721Transfer) => Promise<void>;
};

const THIRTY_SECONDS_IN_MS = 30 * 1000;

export const KRC721RecentTransferContext =
  createContext<KRC721RecentTransferContextType>(defaultValues);

export function KRC721RecentTransferProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { account } = useWalletManager();
  const [recentKrc721Transfer, setRecentKrc721Transfer, isLoading] =
    useStorageState<Array<RecentKRC721Transfer>>(RECENT_KRC721_TRANSFER, []);

  const addRecentKRC721Transfer = async (transfer: RecentKRC721Transfer) => {
    if (isLoading) return;

    const recentTransfer = recentKrc721Transfer.filter((transfer) => {
      const isRecent =
        new Date().getTime() - new Date(transfer.at).getTime() <
        THIRTY_SECONDS_IN_MS;

      return isRecent;
    });
    recentTransfer.push(transfer);

    await setRecentKrc721Transfer(recentTransfer);
  };

  const isRecentKRC721Transfer = (tokenId: string) => {
    return !!recentKrc721Transfer.find((transfer) => {
      const sameAssetId = tokenId === transfer.id;
      const sameOriginAddress = transfer.from === account?.address;
      const isRecent =
        new Date().getTime() - new Date(transfer.at).getTime() <
        THIRTY_SECONDS_IN_MS;

      return sameAssetId && sameOriginAddress && isRecent;
    });
  };

  return (
    <KRC721RecentTransferContext.Provider
      value={
        isLoading
          ? defaultValues
          : {
              addRecentKRC721Transfer,
              isRecentKRC721Transfer,
            }
      }
    >
      {children}
    </KRC721RecentTransferContext.Provider>
  );
}
