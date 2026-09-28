import { twMerge } from "tailwind-merge";
import { DetailedHTMLProps, ImgHTMLAttributes } from "react";
import placeholderImage from "@/assets/images/nft-placeholder.png";

export default function NFTPlaceholderImage({
  className,
  placeholder,
  onLoad,
  ...props
}: DetailedHTMLProps<ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement> & {
  placeholder?: { className: string };
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <>
      {!isLoaded && (
        <img
          src={placeholderImage}
          alt="Placeholder"
          className={placeholder?.className}
        />
      )}
      <img
        alt={"artwork"}
        // Every card on a page used to fetch at once (both image hosts are
        // HTTP/2, so the per-host connection cap bounds nothing). A lazy
        // image only loads once it has a layout box near the viewport, so
        // until then it is invisible, not display:none.
        loading="lazy"
        className={twMerge(
          className,
          isLoaded ? "block" : "invisible absolute",
        )}
        onLoad={(event) => {
          setIsLoaded(true);
          onLoad?.(event);
        }}
        {...props}
      />
    </>
  );
}
