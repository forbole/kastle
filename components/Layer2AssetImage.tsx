import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import React, { useState, useEffect } from "react";

export default function Layer2AssetImage({
  tokenImage,
  chainImage,
  tokenImageSize = 40,
  chainImageSize = 20,
  chainImageBottomPosition,
  chainImageRightPosition,
}: {
  tokenImage?: string;
  chainImage?: string;
  tokenImageSize?: number;
  chainImageSize?: number;
  chainImageBottomPosition?: number;
  chainImageRightPosition?: number;
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

  const chainImageWithBorderSize = chainImageSize + 4;

  return (
    <div className="relative inline-block">
      <div className="relative">
        <img
          src={imageUrl}
          alt="Token"
          className="rounded-full object-cover shadow-lg"
          style={{
            width: `${tokenImageSize}px`,
            height: `${tokenImageSize}px`,
          }}
          onError={onImageError}
        />
      </div>

      <div
        className="absolute"
        style={{
          bottom: chainImageBottomPosition
            ? `${chainImageBottomPosition}px`
            : "-0.5rem",
          right: chainImageRightPosition
            ? `${chainImageRightPosition}px`
            : "-0.5rem",
        }}
      >
        <img
          src={chainImage ?? kasIcon}
          alt="Chain"
          className="rounded-full border-2 border-[#102832] bg-[#102832] object-cover shadow-md"
          style={{
            width: `${chainImageWithBorderSize}px`,
            height: `${chainImageWithBorderSize}px`,
          }}
        />
      </div>
    </div>
  );
}
