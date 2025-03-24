import useWalletManager from "@/hooks/useWalletManager";
import { useKRC721ByAddress } from "@/hooks/useKRC721";
import KRC721Item from "@/components/dashboard/KRC721Item";

export default function KRC721List() {
  const { account } = useWalletManager();
  const address = account?.address;
  const { data, size, setSize, isLoading } = useKRC721ByAddress(address);

  const hasNexPage = data && data[size - 1]?.next;

  const firstLoading = !data && isLoading;
  return (
    <>
      <div className="grid grid-cols-3 items-end gap-3">
        {firstLoading &&
          Array(6).map((_, index) => (
            <div
              key={index}
              className="h-28 w-28 animate-pulse rounded-xl bg-daintree-800"
            />
          ))}

        {data?.map((page) =>
          page.result.map((krc721) => (
            <KRC721Item
              key={`${krc721.tick}-${krc721.tokenId}`}
              tick={krc721.tick}
              tokenId={krc721.tokenId}
            />
          )),
        )}
      </div>

      {/* Load more button */}
      {hasNexPage && (
        <button
          onClick={() => {
            if (isLoading) return;
            setSize(size + 1);
          }}
          className="mb-4 mt-4 w-full rounded-lg bg-[#102832] py-2 text-white hover:bg-[#3B6273]"
        >
          {isLoading ? (
            <div
              className="inline-block size-6 animate-spin self-center rounded-full border-[6px] border-current border-t-[#A2F5FF] text-icy-blue-600"
              role="status"
              aria-label="loading"
            />
          ) : (
            "Load More"
          )}
        </button>
      )}
    </>
  );
}
