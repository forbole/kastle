import { useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useErc721Info from "@/hooks/evm/useErc721Info";
import { Hex, Address } from "viem";
import Attributes from "../nft/Attributes";
import Description from "../nft/Description";
import TransferButton from "../nft/TransferButton";
import InfoImage from "../nft/InfoImage";
import Name from "../nft/Name";

export default function Erc721() {
  const { chainId, contractAddress, tokenId } = useParams<{
    chainId: Hex;
    contractAddress: Address;
    tokenId: string;
  }>();
  const { data } = useErc721Info(chainId, contractAddress, tokenId);
  const { wallet } = useWalletManager();

  const isLoading = !data;
  const name = data?.metadata?.name ?? "Empty Name";

  const isLedger = wallet?.type === "ledger";
  const isTransferDisabled = isLedger;

  // Description
  const description =
    data && data.metadata?.description
      ? data.metadata.description
      : "No description";

  const attributes = data?.metadata?.attributes ?? [];

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll p-4">
      <Header title={name} showClose={false} />

      <InfoImage
        isLoading={isLoading}
        downloadedName={data?.metadata?.name ?? "ERC721"}
        imageUrl={data?.image_url ?? ""}
      />

      <div className="mt-6 flex flex-col gap-2">
        <Name
          isLoading={isLoading}
          name={name}
          owner={data?.owner.hash ?? ""}
        />

        <Description description={description} isLoading={isLoading} />

        <Attributes attributes={attributes} />

        <TransferButton
          disabledMessage={
            isTransferDisabled
              ? "Ledger doesn’t support transfer function currently."
              : undefined
          }
          redirectTo={`/erc721/${chainId}/${contractAddress}/${tokenId}/transfer`}
        />
      </div>
    </div>
  );
}
