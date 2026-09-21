import { useParams } from "react-router-dom";
import { useKRC721Details, useKRC721Token } from "@/hooks/krc721/useKRC721";
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
  const { data, error, mutate } = useKRC721Details(tick, tokenId);
  const {
    data: token,
    error: tokenError,
    isLoading: isTokenLoading,
  } = useKRC721Token(tick, tokenId);
  const { wallet } = useWalletManager();
  const { account } = useWalletManager();
  const { isRecentKRC721Transfer } = useKRC721RecentTransfer();

  // A failed metadata fetch is a message, not a skeleton that pulses forever.
  const isLoading = !data && !error;
  const name = `${tick} #${tokenId}`;

  const isLedger = wallet?.type === "ledger";

  // Every branch below disables Transfer; the order is "most permanent reason
  // first". Listing state is the money path: transferring a listed NFT
  // orphans the marketplace listing, so an unknown state (fetch failed, still
  // loading) fails closed and says why instead of quietly enabling the button.
  const disabledMessage = isLedger
    ? "Ledger doesn’t support transfer function currently."
    : isRecentKRC721Transfer(tokenId ?? "")
      ? "Your NFT is in pending confirmation. Please wait for the operation to be completed."
      : tokenError
        ? "Couldn’t confirm this NFT is unlisted. Check your connection and try again."
        : isTokenLoading || !token
          ? "Checking listing status…"
          : token.result?.owner !== account?.address
            ? "This NFT isn’t owned by this account."
            : token.result?.status?.state !== "unlisted"
              ? "This NFT is listed on a marketplace. Cancel the listing before transferring."
              : undefined;

  // Description
  const description =
    data && data.description ? data.description : "No description";

  const attributes = data?.attributes ?? [];

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll p-4">
      <Header title={name} showClose={false} />

      {error ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-daintree-400">
          Couldn’t load this NFT’s metadata. Check your connection and try
          again.
          <button
            type="button"
            className="rounded-full border border-daintree-400 px-4 py-1 text-white"
            onClick={() => mutate()}
          >
            Retry
          </button>
        </div>
      ) : (
        <InfoImage
          isLoading={isLoading}
          downloadedName={`${tick}_${tokenId}`}
          imageUrl={convertIPFStoHTTP(data?.image ?? "")}
        />
      )}

      <div className="mt-6 flex flex-col gap-2">
        <Name
          isLoading={isLoading}
          name={name}
          owner={account?.address ?? ""}
        />

        {!error && (
          <Description description={description} isLoading={isLoading} />
        )}

        {/* KRC721 attributes */}
        <Attributes attributes={attributes} />

        <TransferButton
          disabledMessage={disabledMessage}
          redirectTo={`/krc721-transfer/${tick}/${tokenId}`}
        />
      </div>
    </div>
  );
}
