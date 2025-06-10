import kasIcon from "@/assets/images/kas-icon.svg";
import React, { useState, useEffect } from "react";

export default function Layer2AssetImage({
  tokenImage,
  chainImage,
}: {
  tokenImage?: string;
  chainImage?: string;
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
          className="h-10 w-10 rounded-full object-cover shadow-lg"
          onError={onImageError}
        />
      </div>

      <div className="absolute -bottom-2 -right-2">
        <img
          src={chainImage ?? kasIcon}
          alt="Chain"
          className="h-6 w-6 rounded-full border-2 border-[#102832] bg-[#102832] object-cover shadow-md"
        />
      </div>
    </div>
  );
}
