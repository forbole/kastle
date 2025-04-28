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
        className={twMerge(className, isLoaded ? "block" : "hidden")}
        onLoad={(event) => {
          setIsLoaded(true);
          onLoad?.(event);
        }}
        {...props}
      />
    </>
  );
}
