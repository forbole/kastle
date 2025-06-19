import kasIcon from "@/assets/images/kas-icon.svg";
import React, { useState, useEffect } from "react";

export default function Layer2AssetImage({
  tokenImage,
  chainImage,
  tokenImageSize = 40,
  chainImageSize = 24,
}: {
  tokenImage?: string;
  chainImage?: string;
  tokenImageSize?: number;
  chainImageSize?: number;
}) {
  const [imageUrl, setImageUrl] = useState(kasIcon);

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenImage) {
      setImageUrl(tokenImage);
    }
  }, [tokenImage]);

  return (
    <div className="relative inline-block">
      <div className="relative">
        <img
          src={imageUrl}
          alt="Token"
          className={`rounded-full object-cover shadow-lg h-[${tokenImageSize}px] w-[${tokenImageSize}px]`}
          onError={onImageError}
        />
      </div>

      <div className="absolute -bottom-2 -right-2">
        <img
          src={chainImage ?? kasIcon}
          alt="Chain"
          className={`rounded-full border-2 border-[#102832] bg-[#102832] object-cover shadow-md h-[${chainImageSize}px] w-[${chainImageSize}px]`}
        />
      </div>
    </div>
  );
}
