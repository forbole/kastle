import avatarIcon from "@/assets/images/avatar.png";
import { walletAddressEllipsis } from "@/lib/utils.ts";
import React, { useState } from "react";
import { RecentAddress } from "@/contexts/RecentAddressesContext.tsx";
import { Tooltip } from "react-tooltip";

export default function RecentAddressItem({
  recentAddress,
  onClick,
}: {
  recentAddress: RecentAddress;
  onClick: () => void;
}) {
  const { fetchDomainInfo } = useKns();
  const [resolvedAddress, setResolvedAddress] = useState<string>();
  const hasDomain = !!recentAddress.domain;

  useEffect(() => {
    if (!recentAddress.domain) {
      return;
    }
    fetchDomainInfo(recentAddress.domain).then((domainInfo) =>
      setResolvedAddress(domainInfo?.data?.owner),
    );
  }, []);

  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-3 rounded-xl bg-daintree-800 p-3 hover:bg-daintree-700"
      onClick={onClick}
    >
      <img alt="castle" className="h-[40px] w-[40px]" src={avatarIcon} />
      <div className="flex flex-grow flex-col gap-1">
        <span className="flex items-center gap-2 text-base text-white">
          {hasDomain ? (
            <>
              <span>{recentAddress.domain}</span>
              {resolvedAddress !== recentAddress.kaspaAddress && (
                <a
                  data-tooltip-id="address-changed-warning"
                  data-tooltip-content="The address linked to this domain was updated recently."
                >
                  <Tooltip
                    data-tooltip-id="address-changed-warning"
                    id="address-changed-warning"
                    place="top"
                    style={{
                      backgroundColor: "#374151",
                      color: "#EAB308",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "2px 8px",
                    }}
                  />
                  <i className="hn hn-exclamation-triangle text-[18px] text-[#CA8A04]"></i>
                </a>
              )}
            </>
          ) : (
            <span>{walletAddressEllipsis(recentAddress.kaspaAddress)}</span>
          )}
        </span>
        {hasDomain && (
          <span className="flex items-center justify-between text-sm text-daintree-400">
            {walletAddressEllipsis(resolvedAddress ?? "")}
          </span>
        )}
      </div>
    </button>
  );
}
