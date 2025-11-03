import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import { twMerge } from "tailwind-merge";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAll from "@/components/HoverTooltip";
import downloadImage from "@/assets/images/download.svg";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { Tooltip } from "react-tooltip";
import NFTPlaceholderImage from "@/components/NFTPlaceholderImage.tsx";
import { useBoolean } from "usehooks-ts";
import useErc721Info from "@/hooks/evm/useErc721Info";
import { Hex, Address } from "viem";

const SHOW_DESCRIPTION_LIMIT = 105;
const SHOW_ATTRIBUTES_LIMIT = 4;

function toSentenceCase(sentence: string) {
  if (!sentence) return "";
  return sentence.charAt(0).toUpperCase() + sentence.slice(1).toLowerCase();
}

export default function Erc721() {
  const navigate = useNavigate();
  const { value: showDownload, setTrue: setShowDownload } = useBoolean(false);
  const { chainId, contractAddress, tokenId } = useParams<{
    chainId: Hex;
    contractAddress: Address;
    tokenId: string;
  }>();
  const { data } = useErc721Info(
    chainId,
    contractAddress,
    tokenId,
  );
  const { wallet } = useWalletManager();
  const [seeMoreDescription, setSeeMoreDescription] = useState(false);
  const [showMoreAttributes, setShowMoreAttributes] = useState(false);
  const { account } = useWalletManager();

  const isLoading = !data;
  const name = data?.metadata?.name ?? "Empty Name";

  const isLedger = wallet?.type === "ledger";
  const isTransferDisabled = isLedger;

  // Description
  const description =
    data && data.metadata?.description
      ? data.metadata.description
      : "No description";
  const shownDescription = seeMoreDescription
    ? description
    : description.slice(0, SHOW_DESCRIPTION_LIMIT);

  const attributes =
    data?.metadata?.attributes?.map((attr) => {
      return {
        trait_type: toSentenceCase(attr.trait_type),
        value: attr.value,
      };
    }) ?? [];

  const shownAttributes = showMoreAttributes
    ? attributes
    : attributes.slice(0, SHOW_ATTRIBUTES_LIMIT);

  const handleDownload = async (imageUrl: string) => {
    const result = await fetch(imageUrl);
    const blob = await result.blob();

    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = `${data?.metadata?.name ?? `${contractAddress}_${tokenId}`}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll p-4">
      <Header title={name} showClose={false} />

      {isLoading ? (
        <div className="mx-auto h-48 w-48 animate-pulse rounded-xl bg-[#102832]"></div>
      ) : (
        <div className="relative mx-auto h-48 w-48 rounded-xl bg-[#102832]">
          <NFTPlaceholderImage
            src={data.image_url}
            alt="KRC721"
            className="m-auto max-h-48 max-w-48 rounded-xl"
            onLoad={setShowDownload}
          />
          {showDownload && (
            <div
              className="absolute bottom-0 right-0 m-2 cursor-pointer rounded-full bg-[#3B6273]"
              onClick={
                data.image_url
                  ? () => handleDownload(data.image_url!)
                  : undefined
              }
            >
              <img src={downloadImage} alt="expand" />
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {/* KRC721 name */}
        <div
          className={twMerge(
            "rounded-xl border border-daintree-700 bg-[#102832] p-4",
            !data && "h-16 animate-pulse",
          )}
        >
          {!isLoading && (
            <div className="flex flex-col gap-2 rounded-xl bg-[#102832]">
              <div className="flex items-center gap-2 text-sm leading-none">
                <h3>{name}</h3>
                <Copy textToCopy={name} id="copy-krc721-name">
                  <i className="hn hn-copy cursor-pointer text-[#7B9AAA]"></i>
                </Copy>
              </div>
              <div className="flex items-center gap-2 text-xs leading-none text-[#7B9AAA]">
                <HoverShowAll
                  text={account?.address ?? ""}
                  tooltipWidth="22rem"
                >
                  {account && textEllipsis(account.address)}
                </HoverShowAll>
                <Copy
                  textToCopy={account?.address ?? ""}
                  id="copy-krc721-owner"
                >
                  <i className="hn hn-copy cursor-pointer text-[#7B9AAA]"></i>
                </Copy>
              </div>
            </div>
          )}
        </div>

        {/* KRC721 description */}
        <div
          className={twMerge(
            "rounded-xl border border-daintree-700 bg-[#102832] p-4 text-sm",
            !data && "h-24 animate-pulse",
          )}
        >
          {!isLoading && (
            <>
              <h3>Description</h3>
              <span className="text-xs text-[#7B9AAA]">{shownDescription}</span>
              {!seeMoreDescription &&
                description.length > SHOW_DESCRIPTION_LIMIT && (
                  <p
                    className="cursor-pointer text-cyan-500 underline"
                    onClick={() => setSeeMoreDescription(true)}
                  >
                    See more
                  </p>
                )}
            </>
          )}
        </div>

        {/* KRC721 attributes */}

        <div className="space-y-3 rounded-xl border border-daintree-700 bg-daintree-800 p-4">
          <h3 className="text-sm">Attributes</h3>

          {attributes.length > 0 ? (
            <>
              <div className="flex justify-between px-2 text-[#7B9AAA]">
                <span>TRAIT TYPE</span>
                <span>VALUE</span>
              </div>
              <ul className="flex flex-col">
                {shownAttributes.map((attr, index) => (
                  <li
                    key={index}
                    className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:rounded-t-xl last:rounded-b-xl"
                  >
                    <div className="flex w-full items-start justify-between">
                      <span>{attr.trait_type}</span>
                      <Copy
                        textToCopy={attr.value}
                        id={`copy-krc721-attribute-${index}`}
                      >
                        <span className="cursor-pointer font-medium">
                          {attr.value}
                        </span>
                      </Copy>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="py-10 text-center text-base text-daintree-400">
              No traits available
            </div>
          )}

          {!showMoreAttributes && attributes.length > SHOW_ATTRIBUTES_LIMIT && (
            <div
              className="mx-auto cursor-pointer text-center text-base font-semibold leading-none text-cyan-500"
              onClick={() => setShowMoreAttributes(true)}
            >
              <i className="hn hn-chevron-down ml-1"></i> Show more
            </div>
          )}
        </div>

        <div className="pb-4 pt-6 text-base font-semibold text-[#083344]">
          <>
            {isTransferDisabled && (
              <Tooltip
                id="transer-disabled"
                style={{
                  backgroundColor: "#203C49",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "8px",
                  width: "60%",
                }}
                opacity={1}
                place="top"
              />
            )}
            <button
              type="button"
              data-tooltip-id="transer-disabled"
              data-tooltip-content={
                isLedger
                  ? "Ledger doesn’t support deploy function currently."
                  : "Your NFT is in pending confirmation. Please wait for the operation to be completed."
              }
              className="inline-flex w-full rounded-full border border-white py-3 text-white disabled:border-[#093446] disabled:text-[#083344]"
              disabled={isTransferDisabled}
              onClick={() =>
                navigate(
                  `/erc721-transfer/${chainId}/${contractAddress}/${tokenId}`,
                )
              }
            >
              <span className="ml-[120px]">Transfer</span>
              <div
                className={twMerge(
                  "ml-2 rounded-full px-2 text-[10px]",
                  !isTransferDisabled
                    ? "bg-icy-blue-400 text-white"
                    : "bg-[#164E63] bg-opacity-30 text-[#0E7490]",
                )}
              >
                New
              </div>
            </button>
          </>
        </div>
      </div>
    </div>
  );
}
