import useWalletManager from "@/hooks/useWalletManager";
import { useKRC721ByAddress } from "@/hooks/useKRC721";
import KRC721Item from "@/components/dashboard/KRC721Item";

export default function KRC721List() {
  const { account } = useWalletManager();
  const address = account?.address;
  const { data } = useKRC721ByAddress(address);

  return (
    data && (
      <div className="grid grid-cols-3 gap-3">
        {data.result.map((krc721, index) => (
          <KRC721Item key={index} tick={krc721.tick} tokenId={krc721.tokenId} />
        ))}
      </div>
    )
  );
}
