import { useParams } from "react-router-dom";
import { useKRC721Details } from "@/hooks/krc721/useKRC721";
import Header from "@/components/GeneralHeader";
import { convertIPFStoHTTP } from "@/lib/utils";
import useKRC721RecentTransfer from "@/hooks/krc721/useKRC721RecentTransfer";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import InfoImage from "../nft/InfoImage";
import Name from "../nft/Name";
import Description from "../nft/Description";
import Attributes from "../nft/Attributes";
import TransferButton from "../nft/TransferButton";

export default function KRC721() {
  const { tick, tokenId } = useParams();
  const { data } = useKRC721Details(tick, tokenId);
  const { wallet } = useWalletManager();
  const { account } = useWalletManager();
  const { isRecentKRC721Transfer } = useKRC721RecentTransfer();

  const isLoading = !data;
  const name = `${tick} #${tokenId}`;

  const isLedger = wallet?.type === "ledger";
  const isTransferDisabled = isLedger || isRecentKRC721Transfer(tokenId ?? "");

  // Description
  const description =
    data && data.description ? data.description : "No description";

  const attributes = data?.attributes ?? [];

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll p-4">
      <Header title={name} showClose={false} />

      <InfoImage
        isLoading={isLoading}
        downloadedName={`${tick}_${tokenId}`}
        imageUrl={convertIPFStoHTTP(data?.image ?? "")}
      />

      <div className="mt-6 flex flex-col gap-2">
        <Name
          isLoading={isLoading}
          name={name}
          owner={account?.address ?? ""}
        />

        <Description description={description} isLoading={isLoading} />

        {/* KRC721 attributes */}
        <Attributes attributes={attributes} />

        <TransferButton
          disabledMessage={
            isTransferDisabled
              ? isLedger
                ? "Ledger doesn’t support transfer function currently."
                : "Your NFT is in pending confirmation. Please wait for the operation to be completed."
              : undefined
          }
          redirectTo={`/krc721-transfer/${tick}/${tokenId}`}
        />
      </div>
    </div>
  );
}
