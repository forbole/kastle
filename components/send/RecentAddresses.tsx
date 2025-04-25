import { twMerge } from "tailwind-merge";
import React from "react";
import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import { useOnClickOutside } from "usehooks-ts";
import { RecentAddress } from "@/contexts/RecentAddressesContext.tsx";
import RecentAddressItem from "@/components/recent-addresses/RecentAddressItem.tsx";

type TickerSelectAddressProps = {
  isShown: boolean;
  hideAddressSelect: () => void;
};

export default function RecentAddresses({
  isShown,
  hideAddressSelect,
}: TickerSelectAddressProps) {
  const { recentAddresses } = useRecentAddresses();
  const { setValue } = useFormContext<SendFormData>();

  const ref = useRef(null);
  const handleClickOutside = () => hideAddressSelect();

  useOnClickOutside(ref, handleClickOutside);

  const selectAddress = (recentAddress: RecentAddress) => {
    setValue(
      "userInput",
      recentAddress.domain ? recentAddress.domain : recentAddress.kaspaAddress,
      { shouldValidate: true },
    );
    hideAddressSelect();
  };

  if (recentAddresses.length === 0) {
    return null;
  }

  return (
    <>
      {/* Pop over */}
      <div
        ref={ref}
        className={twMerge(
          "no-scrollbar absolute left-0 top-20 z-50 h-[18rem] w-full overflow-y-scroll rounded-2xl border border-daintree-700 bg-daintree-800 transition-opacity duration-300",
          isShown ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex flex-col gap-2 p-2">
          {recentAddresses.map((recentAddress) => (
            <RecentAddressItem
              key={recentAddress.kaspaAddress}
              recentAddress={recentAddress}
              onClick={() => selectAddress(recentAddress)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
