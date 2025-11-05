import { useBoolean } from "usehooks-ts";
import downloadImage from "@/assets/images/download.svg";
import NFTPlaceholderImage from "@/components/NFTPlaceholderImage";

type InfoImageProps = {
  isLoading?: boolean;
  downloadedName: string;
  imageUrl: string;
};

export default function InfoImage({
  isLoading,
  downloadedName,
  imageUrl,
}: InfoImageProps) {
  const { value: showDownload, setTrue: setShowDownload } = useBoolean(false);

  const handleDownload = async (imageUrl: string) => {
    const result = await fetch(imageUrl);
    const blob = await result.blob();

    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = `${downloadedName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {isLoading ? (
        <div className="mx-auto h-48 w-48 animate-pulse rounded-xl bg-[#102832]"></div>
      ) : (
        <div className="relative mx-auto h-48 w-48 rounded-xl bg-[#102832]">
          <NFTPlaceholderImage
            src={imageUrl}
            alt={downloadedName ?? "ERC721"}
            className="m-auto max-h-48 max-w-48 rounded-xl"
            onLoad={setShowDownload}
          />
          {showDownload && (
            <div
              className="absolute bottom-0 right-0 m-2 cursor-pointer rounded-full bg-[#3B6273]"
              onClick={imageUrl ? () => handleDownload(imageUrl) : undefined}
            >
              <img src={downloadImage} alt="expand" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
