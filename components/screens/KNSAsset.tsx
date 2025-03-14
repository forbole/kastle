import { useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import patchCheckFill from "@/assets/images/patch-check-fill.png";
import avatarIcon from "@/assets/images/avatar.png";
import { useKns, AssetDataWithId } from "@/hooks/useKns.ts";
import { useState, useRef } from "react";
import { walletAddressEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import HoverShowAll from "@/components/HoverShowAll";

export default function KNSAsset() {
  const { assetId } = useParams();
  const { fetchDomainDetails } = useKns();
  const [asset, setAsset] = useState<AssetDataWithId>();
  const callOnce = useRef(false);

  useEffect(() => {
    if (callOnce.current) return;

    if (assetId) {
      callOnce.current = true;
      fetchDomainDetails(assetId).then((data) => {
        setAsset(data);
      });
    }
  }, [assetId]);

  return (
    <div className="flex h-full flex-col p-4">
      <Header title="KNS Asset" showClose={false} />

      {asset && (
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex-1 space-y-3">
            <div className="inline-flex w-full items-center gap-x-4 rounded-xl border border-daintree-700 bg-daintree-800 px-4 py-3 text-sm">
              <div className="relative">
                {asset.isVerifiedDomain && (
                  <img
                    src={patchCheckFill}
                    alt="verified"
                    className="absolute right-0 top-0 -mr-1 -mt-1 h-3 w-3 text-daintree-800"
                  />
                )}
                <img
                  alt="castle"
                  className="h-[40px] w-[40px]"
                  src={avatarIcon}
                />
              </div>
              <div className="flex flex-grow flex-col gap-1">
                <div className="flex items-center gap-2 text-base text-white">
                  <span>{asset.asset}</span>
                  <Copy textToCopy={asset.asset} id="copy-asset" place="top">
                    <i className="hn hn-copy cursor-pointer text-[#7B9AAA]" />
                  </Copy>
                </div>
                <div className="flex items-center gap-2 text-sm text-daintree-400">
                  <HoverShowAll
                    text={asset.owner}
                    id="hover-show-all-asset-owner"
                    tooltipWidth="22rem"
                  >
                    <span>{walletAddressEllipsis(asset.owner)}</span>
                  </HoverShowAll>
                  <Copy textToCopy={asset.owner} id="copy-asset-owner">
                    <i className="hn hn-copy cursor-pointer text-[#7B9AAA]" />
                  </Copy>
                </div>
              </div>
            </div>
            <ul className="mt-3 flex flex-col rounded-xl bg-daintree-800">
              <li className="-mt-px inline-flex items-center gap-x-2 rounded-t-xl border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="cursor-pointer font-medium">
                    Inscription Number
                  </span>
                  <Copy textToCopy={asset.id} id="copy-asset-id-number">
                    <span className="cursor-pointer font-medium">
                      #{asset.id}
                    </span>
                  </Copy>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="cursor-pointer font-medium">
                    Inscription ID
                  </span>
                  <span className="cursor-pointer font-medium">
                    <HoverShowAllCopy
                      text={asset.assetId}
                      id="hover-show-all-copy-asset-id"
                      tooltipWidth="20rem"
                      place="bottom-end"
                    >
                      {walletAddressEllipsis(asset.assetId)}
                    </HoverShowAllCopy>
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="cursor-pointer font-medium">Status</span>
                  <Copy textToCopy={asset.status} id="copy-asset-status">
                    <span className="cursor-pointer font-medium">
                      {asset.status}
                    </span>
                  </Copy>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 rounded-b-xl border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="cursor-pointer font-medium">Timestamp</span>
                  <Copy
                    textToCopy={asset.creationBlockTime}
                    id="copy-asset-timestamp"
                  >
                    <span className="cursor-pointer font-medium">
                      {asset.creationBlockTime}
                    </span>
                  </Copy>
                </div>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-2 text-base font-semibold text-[#083344]">
            <button className="inline-flex w-full rounded-full border border-[#093446] py-3">
              <span className="ml-[120px]">Transfer KNS</span>
              <div className="ml-2 rounded-full bg-[#164E63] bg-opacity-30 px-2 text-[10px] text-[#0E7490]">
                Coming soon
              </div>
            </button>
            <button className="inline-flex w-full rounded-full border border-[#093446] py-3">
              <span className="ml-[140px]">List KNS</span>
              <div className="ml-2 rounded-full bg-[#164E63] bg-opacity-30 px-2 text-[10px] text-[#0E7490]">
                Coming soon
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
