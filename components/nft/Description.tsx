import { useState } from "react";
import { twMerge } from "tailwind-merge";

const SHOW_DESCRIPTION_LIMIT = 105;

type DescriptionProps = {
  description: string;
  isLoading: boolean;
};

export default function Description({
  description,
  isLoading,
}: DescriptionProps) {
  const [seeMoreDescription, setSeeMoreDescription] = useState(false);

  const shownDescription = seeMoreDescription
    ? description
    : description.slice(0, SHOW_DESCRIPTION_LIMIT);

  return (
    <div
      className={twMerge(
        "rounded-xl border border-daintree-700 bg-[#102832] p-4 text-sm",
        isLoading && "h-24 animate-pulse",
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
  );
}
