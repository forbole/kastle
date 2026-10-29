import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import NameCard from "@/components/dashboard/NameCard";
import { DetailList, DetailRow, ExplorerLink } from "@/components/DetailList";
import { explorerAddressLinks } from "@/components/screens/Settings";
import { useDotkName } from "@/hooks/dotk/useDotkName";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import AssetSendButton from "@/components/AssetSendButton";

// Read-only apart from Send (the transfer flow). TODO(dotk): records / release
// are covenant-tx write paths and live in later phases, not here.
function AddressRow({
  label,
  address,
  explorerUrl,
  id,
}: {
  label: string;
  address: string;
  explorerUrl?: string;
  id: string;
}) {
  return (
    <DetailRow label={label}>
      {explorerUrl && (
        <ExplorerLink label={`View ${label} in explorer`} url={explorerUrl} />
      )}
      <span className="cursor-pointer">
        <HoverShowAllCopy
          text={address}
          id={id}
          tooltipWidth="20rem"
          place="bottom-end"
        >
          {textEllipsis(address)}
        </HoverShowAllCopy>
      </span>
    </DetailRow>
  );
}

export default function DotkAsset() {
  const navigate = useNavigate();
  const { name } = useParams();
  const { networkId } = useRpcClientStateful();
  const { lookup, isLoading, error } = useDotkName(name);
  const { account, wallet } = useWalletManager();
  const { isDotkEnabled } = useFeatureFlags();

  const explorer =
    explorerAddressLinks[networkId ?? NetworkType.Mainnet] ?? undefined;
  const resolved = lookup?.kind === "active" ? lookup.resolved : undefined;
  const deedAddress =
    resolved?.deedAddress ??
    (lookup?.kind === "pending" ? lookup.deedAddress : undefined);
  const records = resolved?.records ?? {};
  const isLedger = wallet?.type === "ledger";
  const canTransfer =
    isDotkEnabled &&
    !!resolved?.address &&
    resolved.address === account?.address;
  const toDashboard = () => navigate("/dashboard");

  // Not-found is not "free": a failed or unanswered lookup says so rather than
  // implying the name is unowned.
  const notice = isLoading
    ? "Loading…"
    : error
      ? "Couldn’t load this name. Try again later."
      : lookup?.kind === "pending"
        ? "This registration is pending and not active yet."
        : lookup?.kind === "ownerUnknown"
          ? "The owner of this name is not known yet."
          : lookup?.kind === "free"
            ? "This name is not registered."
            : undefined;

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title={name ?? ""}
        onBack={toDashboard}
        onClose={toDashboard}
      />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto">
        <Copy textToCopy={name ?? ""} id="copy-dotk-name" place="top">
          <NameCard
            size="lg"
            name={name ?? ""}
            source="dotk"
            onClick={() => {}}
          />
        </Copy>

        {notice && (
          <div className="w-full py-2 text-center text-sm text-daintree-400">
            {notice}
          </div>
        )}

        {lookup && (
          <div className="flex w-full flex-col gap-2">
            <h2 className="text-base font-semibold text-daintree-300">
              Details
            </h2>
            <DetailList>
              {resolved?.address && (
                <AddressRow
                  label="Owner"
                  address={resolved.address}
                  explorerUrl={explorer && `${explorer}${resolved.address}`}
                  id="hover-show-all-copy-dotk-owner"
                />
              )}
              {deedAddress && (
                <AddressRow
                  label="Deed address"
                  address={deedAddress}
                  id="hover-show-all-copy-dotk-deed"
                />
              )}
              <DetailRow label="Status">
                <span className="capitalize">
                  {lookup.kind === "active" || lookup.kind === "pending"
                    ? lookup.kind
                    : lookup.kind === "free"
                      ? "Not registered"
                      : "Unknown"}
                </span>
              </DetailRow>
              {resolved && (
                <>
                  <DetailRow label="Records">
                    <span>{Object.keys(records).length}</span>
                  </DetailRow>
                  <DetailRow label="Primary">
                    <span>{records.primary === true ? "Yes" : "No"}</span>
                  </DetailRow>
                </>
              )}
            </DetailList>
          </div>
        )}
      </div>

      {canTransfer && isLedger && (
        <span className="shrink-0 pt-2 text-center text-xs text-daintree-400">
          Ledger can’t sign covenant (version 1) transactions, so .k names can’t
          be transferred from it.
        </span>
      )}
      {canTransfer && !isLedger && name && (
        <AssetSendButton
          ticker={name}
          onClick={() => navigate(`/dotk/${name}/transfer`)}
        />
      )}
    </div>
  );
}
