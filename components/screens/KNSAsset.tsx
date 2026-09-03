import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import NameCard from "@/components/dashboard/NameCard";
import { DetailList, DetailRow, ExplorerLink } from "@/components/DetailList";
import { explorerAddressLinks } from "@/components/screens/Settings.tsx";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useAssetDetails } from "@/hooks/kns/useKns";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import { Tooltip } from "react-tooltip";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKNSRecentTransfer from "@/hooks/kns/useKNSRecentTransfer";

export default function KNSAsset() {
  const navigate = useNavigate();
  const { wallet } = useWalletManager();
  const { assetId } = useParams();
  const [settings] = useSettings();
  const { data: response } = useAssetDetails(assetId ?? "");
  const { isRecentKNSTransfer } = useKNSRecentTransfer();

  const asset = response?.data;
  const isLedger = wallet?.type === "ledger";
  const isTransferDisabled =
    asset?.status !== "default" ||
    isLedger ||
    isRecentKNSTransfer(assetId ?? "");

  return (
    <div className="flex h-full flex-col p-4">
      <Header
        title={asset?.asset ?? ""}
        titleClassName="min-w-0 flex-1 break-words text-center tracking-[0.1px] text-[#e5e7eb]"
        showClose={false}
        onBack={() => navigate("/dashboard")}
      />

      {asset && (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
          {/* The design pins the button bar to the bottom and scrolls the
              content behind it -- its own render hides the Timestamp row. A
              plain flex column overflowed the 600px popup and pushed both
              pills off screen. */}
          <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto">
            {/* Clicking the hero copies the domain. Copy owns the click and
                the "Copied" tooltip, so the card's own handler stays empty --
                this replaces the copy glyph the old avatar hero carried. */}
            <Copy textToCopy={asset.asset} id="copy-asset" place="top">
              <NameCard
                size="lg"
                name={asset.asset}
                source="kas"
                isVerified={asset.isVerifiedDomain}
                onClick={() => {}}
              />
            </Copy>

            <div className="w-full">
              <DetailList>
                <DetailRow label="Inscription Number">
                  <Copy textToCopy={asset.id} id="copy-asset-id-number">
                    <span className="cursor-pointer">#{asset.id}</span>
                  </Copy>
                </DetailRow>

                {/* No external link: assetId is a KNS inscription id with no
                    user-facing page in any explorer the extension knows about.
                    The icon goes on Owner only rather than pointing nowhere. */}
                <DetailRow label="Asset ID">
                  <span className="cursor-pointer">
                    <HoverShowAllCopy
                      text={asset.assetId}
                      id="hover-show-all-copy-asset-id"
                      tooltipWidth="20rem"
                      place="bottom-end"
                    >
                      {textEllipsis(asset.assetId)}
                    </HoverShowAllCopy>
                  </span>
                </DetailRow>

                <DetailRow label="Owner">
                  <ExplorerLink
                    label="View owner in explorer"
                    url={`${explorerAddressLinks[settings?.networkId ?? NetworkType.Mainnet]}${asset.owner}`}
                  />
                  <span className="cursor-pointer">
                    <HoverShowAllCopy
                      text={asset.owner}
                      id="hover-show-all-copy-asset-owner"
                      tooltipWidth="20rem"
                      place="bottom-end"
                    >
                      {textEllipsis(asset.owner)}
                    </HoverShowAllCopy>
                  </span>
                </DetailRow>

                <DetailRow label="Status">
                  <Copy textToCopy={asset.status} id="copy-asset-status">
                    <span className="cursor-pointer">{asset.status}</span>
                  </Copy>
                </DetailRow>

                <DetailRow label="Timestamp">
                  <Copy
                    textToCopy={asset.creationBlockTime}
                    id="copy-asset-timestamp"
                  >
                    <span className="cursor-pointer">
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
                </DetailRow>
              </DetailList>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            {isTransferDisabled && (
              <Tooltip
                id="transfer-disabled"
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
              data-tooltip-id="transfer-disabled"
              data-tooltip-content={
                isLedger
                  ? "Ledger doesn’t support deploy function currently."
                  : "This domain is listed for sale and must be unlisted before transferring."
              }
              className="inline-flex w-full items-center justify-center rounded-full border border-white px-4 py-[14px] text-[15px] font-semibold text-white disabled:border-[#093446] disabled:text-[#083344]"
              disabled={isTransferDisabled}
              onClick={() => navigate(`/kns-transfer/${assetId}`)}
            >
              Transfer
            </button>

            <button
              type="button"
              className="relative inline-flex w-full items-center justify-center rounded-full border border-icy-blue-800 px-4 py-[14px] text-[15px] font-semibold text-icy-blue-800"
              disabled
            >
              <span>List</span>
              {/* Zero-width slot so the badge never shifts the centred label.
                  The design's own is a flex item; as a plain block the inner
                  pill inherited width 0 and squashed, so it is absolutely
                  positioned off the slot instead. */}
              <span className="relative w-0">
                <span className="absolute left-[10px] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-icy-blue-700/30 px-[5.5px] py-px text-[10px] font-medium leading-4 text-icy-blue-500">
                  Coming soon
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
