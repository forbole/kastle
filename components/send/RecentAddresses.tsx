import { twMerge } from "tailwind-merge";
import React from "react";
import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import avatarIcon from "@/assets/images/avatar.png";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import { walletAddressEllipsis } from "@/lib/utils.ts";
import { useOnClickOutside } from "usehooks-ts";
import { RecentAddress } from "@/contexts/RecentAddressesContext.tsx";

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
          "no-scrollbar absolute left-0 top-32 z-50 h-[18rem] w-full overflow-y-scroll rounded-2xl border border-daintree-700 bg-daintree-800 transition-opacity duration-300",
          isShown ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex flex-col gap-2 p-2">
          {recentAddresses.map((recentAddress) => {
            const hasDomain = !!recentAddress.domain;

            return (
              <button
                key={recentAddress.kaspaAddress}
                type="button"
                className="flex cursor-pointer items-center gap-3 rounded-xl bg-daintree-800 p-3 hover:bg-daintree-700"
                onClick={() => selectAddress(recentAddress)}
              >
                <img
                  alt="castle"
                  className="h-[40px] w-[40px]"
                  src={avatarIcon}
                />
                <div className="flex flex-grow flex-col gap-1">
                  <span className="flex items-center justify-between text-base text-white">
                    {hasDomain
                      ? recentAddress.domain
                      : walletAddressEllipsis(recentAddress.kaspaAddress)}
                  </span>
                  {hasDomain && (
                    <span className="flex items-center justify-between text-sm text-daintree-400">
                      {walletAddressEllipsis(recentAddress.kaspaAddress)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
