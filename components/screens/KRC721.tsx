import { useParams } from "react-router-dom";
import { useKRC721Details } from "@/hooks/useKRC721";
import Header from "@/components/GeneralHeader";
import { twMerge } from "tailwind-merge";
import { convertIPFStoHTTP, walletAddressEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAll from "@/components/HoverShowAll";
import downloadImage from "@/assets/images/download.svg";

const SHOW_DESCRIPTION_LIMIT = 105;
const SHOW_ATTRIBUTES_LIMIT = 4;

function toSentenceCase(sentence: string) {
  if (!sentence) return "";
  return sentence.charAt(0).toUpperCase() + sentence.slice(1).toLowerCase();
}

export default function KRC721() {
  const { tick, tokenId } = useParams();
  const { data } = useKRC721Details(tick, tokenId);
  const [seeMoreDescription, setSeeMoreDescription] = useState(false);
  const [showMoreAttributes, setShowMoreAttributes] = useState(false);
  const { account } = useWalletManager();

  const isLoading = !data;
  const name = `${tick} #${tokenId}`;

  // Description
  const description =
    data && data.description ? data.description : "No description";
  const shownDescription = seeMoreDescription
    ? description
    : description.slice(0, SHOW_DESCRIPTION_LIMIT);

  const attributes =
    data?.attributes.map((attr) => {
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
    link.download = `${tick}_${tokenId}.png`;
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
          <img
            src={convertIPFStoHTTP(data.image)}
            alt="KRC721"
            className="m-auto max-h-48 max-w-48 rounded-xl"
          />
          <div
            className="absolute bottom-0 right-0 m-2 cursor-pointer rounded-full bg-[#3B6273]"
            onClick={() => handleDownload(convertIPFStoHTTP(data.image))}
          >
            <img src={downloadImage} alt="expand" />
          </div>
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
                  {account && walletAddressEllipsis(account.address)}
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
        {attributes && (
          <div className="space-y-3 rounded-xl border border-daintree-700 bg-daintree-800 p-4">
            <h3 className="text-sm">Attributes</h3>
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

            {!showMoreAttributes &&
              attributes.length > SHOW_ATTRIBUTES_LIMIT && (
                <div
                  className="mx-auto cursor-pointer text-center text-base font-semibold leading-none text-cyan-500"
                  onClick={() => setShowMoreAttributes(true)}
                >
                  <i className="hn hn-chevron-down ml-1"></i> Show more
                </div>
              )}
          </div>
        )}

        <div className="pb-4 pt-6 text-base font-semibold text-[#083344]">
          <button
            className="inline-flex w-full rounded-full border border-[#093446] py-3"
            disabled
          >
            <span className="ml-[123px]">Transfer NFT</span>
            <div className="ml-2 rounded-full bg-[#164E63] bg-opacity-30 px-2 text-[10px] text-[#0E7490]">
              Coming soon
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
