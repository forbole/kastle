import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import NameCard from "@/components/dashboard/NameCard";
import { DetailList, DetailRow, ExplorerLink } from "@/components/DetailList";
import { igraMainnet } from "@/lib/layer2";
import { useInsResolve } from "@/hooks/ins/useIns";
import { textEllipsis } from "@/lib/utils";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";

export default function INSAsset() {
  const navigate = useNavigate();
  const { name } = useParams();
  const { detail } = useInsResolve(name);

  return (
    <div className="flex h-full flex-col p-4">
      <Header
        title={name ?? ""}
        titleClassName="min-w-0 flex-1 break-words text-center tracking-[0.1px] text-[#e5e7eb]"
        showClose={false}
        onBack={() => navigate("/dashboard")}
      />

      {detail && (
        <div className="flex flex-1 flex-col items-center gap-4 pb-6">
          {/* No isVerified: INS exposes no verification flag, so the badge must
              stay absent rather than assert "verified" for every INS name. */}
          <NameCard
            size="lg"
            name={name ?? ""}
            source="igra"
            onClick={() => {}}
          />

          <div className="w-full">
            <DetailList>
              <DetailRow label="Owner">
                {/* INS resolves against a hardcoded mainnet API, so the Igra
                    mainnet explorer is the only matching destination. */}
                <ExplorerLink
                  label="View owner in explorer"
                  url={`${igraMainnet.blockExplorers.default.url}/address/${detail.owner ?? ""}`}
                />
                <span className="cursor-pointer">
                  <HoverShowAllCopy
                    text={detail.owner ?? ""}
                    id="hover-show-all-copy-ins-owner"
                    tooltipWidth="20rem"
                    place="bottom-end"
                  >
                    {textEllipsis(detail.owner ?? "")}
                  </HoverShowAllCopy>
                </span>
              </DetailRow>

              <DetailRow label="Tenure">
                <span>{detail.tenure ?? "-"}</span>
              </DetailRow>

              <DetailRow label="Registry Version">
                <span>{detail.registry_version ?? "-"}</span>
              </DetailRow>

              <DetailRow label="Expires At">
                <span>
                  {detail.expires_at
                    ? new Date(detail.expires_at).toLocaleString("en-GB", {
                        month: "short",
                        day: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })
                    : "-"}
                </span>
              </DetailRow>
            </DetailList>
          </div>
        </div>
      )}
    </div>
  );
}
