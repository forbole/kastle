import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import badgeCheck from "@/assets/images/badge-check.svg";
import avatarIcon from "@/assets/images/avatar.png";
import { useDomainDetails } from "@/hooks/useKns.ts";
import { walletAddressEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import HoverShowAll from "@/components/HoverShowAll";
import { Tooltip } from "react-tooltip";
import React from "react";
import { twMerge } from "tailwind-merge";
import useWalletManager from "@/hooks/useWalletManager.ts";

export default function KNSAsset() {
  const navigate = useNavigate();
  const { wallet } = useWalletManager();
  const { assetId } = useParams();
  const { data: response } = useDomainDetails(assetId ?? "");

  const asset = response?.data;
  const isLedger = wallet?.type === "ledger";
  const isTransferDisabled = asset?.status !== "default" || isLedger;

  return (
    <div className="flex h-full flex-col p-4">
      <Header
        title="KNS Asset"
        showClose={false}
        onBack={() => navigate("/dashboard")}
      />

      {asset && (
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex-1 space-y-3">
            <div className="inline-flex w-full items-center gap-x-4 rounded-xl border border-daintree-700 bg-daintree-800 px-4 py-3 text-sm">
              <div className="relative">
                {asset.isVerifiedDomain && (
                  <img
                    src={badgeCheck}
                    alt="verified"
                    className="absolute right-0 top-0 -mr-1 -mt-1 h-3 w-3"
                  />
                )}
                <img
                  alt="castle"
                  className="h-[40px] w-[40px]"
                  src={avatarIcon}
                />
              </div>
              <div className="flex flex-grow flex-col gap-2">
                <div className="flex items-center gap-2 text-base leading-none text-white">
                  <span>{asset.asset}</span>
                  <Copy textToCopy={asset.asset} id="copy-asset" place="top">
                    <i className="hn hn-copy cursor-pointer text-[#7B9AAA]" />
                  </Copy>
                </div>
                <div className="flex items-center gap-2 text-sm leading-none text-daintree-400">
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
                  <span className="font-medium">Inscription Number</span>
                  <Copy textToCopy={asset.id} id="copy-asset-id-number">
                    <span className="cursor-pointer font-medium">
                      #{asset.id}
                    </span>
                  </Copy>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Asset ID</span>
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
                  <span className="font-medium">Owner</span>
                  <span className="cursor-pointer font-medium">
                    <HoverShowAllCopy
                      text={asset.owner}
                      id="hover-show-all-copy-asset-owner"
                      tooltipWidth="20rem"
                      place="bottom-end"
                    >
                      {walletAddressEllipsis(asset.owner)}
                    </HoverShowAllCopy>
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Status</span>
                  <Copy textToCopy={asset.status} id="copy-asset-status">
                    <span className="cursor-pointer font-medium">
                      {asset.status}
                    </span>
                  </Copy>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 rounded-b-xl border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Timestamp</span>
                  <Copy
                    textToCopy={asset.creationBlockTime}
                    id="copy-asset-timestamp"
                  >
                    <span className="cursor-pointer font-medium">
                      {new Date(asset.creationBlockTime).toLocaleString(
                        "en-GB",
                        {
                          month: "short",
                          day: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZoneName: "short",
                        },
                      )}
                    </span>
                  </Copy>
                </div>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-2 text-base font-semibold">
            <>
              {isTransferDisabled && (
                <Tooltip
                  id="transer-disabled"
                  style={{
                    backgroundColor: "#203C49",
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "8px",
                    width: "60%",
                  }}
                  opacity={1}
                  place="top"
                />
              )}
              <button
                type="button"
                data-tooltip-id="transer-disabled"
                data-tooltip-content={
                  isLedger
                    ? "Ledger doesn’t support deploy function currently."
                    : "This domain is listed for sale and must be unlisted before transferring."
                }
                className="inline-flex w-full rounded-full border border-white py-3 text-white disabled:border-[#093446] disabled:text-[#083344]"
                disabled={isTransferDisabled}
                onClick={() => navigate(`/kns-transfer/${assetId}`)}
              >
                <span className="ml-[120px]">Transfer</span>
                <div
                  className={twMerge(
                    "ml-2 rounded-full px-2 text-[10px]",
                    asset.status === "default"
                      ? "bg-icy-blue-400 text-white"
                      : "bg-[#164E63] bg-opacity-30 text-[#0E7490]",
                  )}
                >
                  New
                </div>
              </button>
            </>

            <button
              className="inline-flex w-full rounded-full border border-[#093446] py-3 text-[#083344]"
              disabled
            >
              <span className="ml-[140px]">List</span>
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
