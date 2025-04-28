import { twMerge } from "tailwind-merge";
import { DetailedHTMLProps, ImgHTMLAttributes } from "react";

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
        <div
          className={twMerge(
            "animate-pulse bg-daintree-700",
            placeholder?.className,
          )}
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
