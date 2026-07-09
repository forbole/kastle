import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import igraIcon from "@/assets/images/network-logos/igra.svg";
import { useInsResolve } from "@/hooks/ins/useIns";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";

export default function INSAsset() {
  const navigate = useNavigate();
  const { name } = useParams();
  const { detail } = useInsResolve(name);

  return (
    <div className="flex h-full flex-col p-4">
      <Header
        title="INS Asset"
        showClose={false}
        onBack={() => navigate("/dashboard")}
      />

      {detail && (
        <div className="flex flex-1 flex-col justify-between">
          <div className="flex-1 space-y-3">
            <div className="inline-flex w-full items-center gap-x-4 rounded-xl border border-daintree-700 bg-daintree-800 px-4 py-3 text-sm">
              <img alt="ins" className="h-[40px] w-[40px]" src={igraIcon} />
              <div className="flex flex-grow flex-col gap-2">
                <div className="flex items-center gap-2 text-base leading-none text-white">
                  <span>{name}</span>
                  <Copy textToCopy={name ?? ""} id="copy-ins-name" place="top">
                    <i className="hn hn-copy cursor-pointer text-[#7B9AAA]" />
                  </Copy>
                </div>
              </div>
            </div>
            <ul className="mt-3 flex flex-col rounded-xl bg-daintree-800">
              <li className="-mt-px inline-flex items-center gap-x-2 rounded-t-xl border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Owner</span>
                  <span className="cursor-pointer font-medium">
                    <HoverShowAllCopy
                      text={detail.owner ?? ""}
                      id="hover-show-all-copy-ins-owner"
                      tooltipWidth="20rem"
                      place="bottom-end"
                    >
                      {textEllipsis(detail.owner ?? "")}
                    </HoverShowAllCopy>
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Tenure</span>
                  <span className="font-medium">{detail.tenure ?? "-"}</span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Registry Version</span>
                  <span className="font-medium">
                    {detail.registry_version ?? "-"}
                  </span>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 rounded-b-xl border border-daintree-700 px-4 py-3 text-sm">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Expires At</span>
                  <span className="font-medium">
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
                </div>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
