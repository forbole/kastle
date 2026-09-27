import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import NameCard from "@/components/dashboard/NameCard";
import { DetailList, DetailRow, ExplorerLink } from "@/components/DetailList";
import { igraMainnet } from "@/lib/layer2";
import { useInsResolve } from "@/hooks/ins/useIns";
import useInsOnChain from "@/hooks/ins/useInsOnChain";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import TransferButton from "@/components/nft/TransferButton";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";

export default function INSAsset() {
  const navigate = useNavigate();
  const { name } = useParams();
  const { detail } = useInsResolve(name);

  // Ownership comes from the on-chain lookup, never from the REST record: the
  // lookup returns the registry and the token id together, so the pair is
  // guaranteed to match. V1 and V2 namespace ids separately, so pairing a v2
  // id with the v1 address (or vice versa) would act on a different asset.
  //
  // Loading and failure are tracked apart: collapsing them into one falsy value
  // showed "Verifying ownership on-chain…" forever after a lookup that had
  // already permanently failed.
  const { record, reason, isLoading } = useInsOnChain(name);

  // The generic ERC-721 flow only gates Ledger at its entry point
  // (ERC721.tsx), so nothing is inherited by linking to the route -- this
  // screen has to carry the same guard itself.
  const { wallet } = useWalletManager();
  const evmAddress = useEvmAddress();
  const isOwner =
    !!record &&
    !!evmAddress &&
    record.owner.toLowerCase() === evmAddress.toLowerCase();

  // Wording mirrors the mobile INS screen; only the Ledger line is
  // extension-only, since mobile has no Ledger wallets.
  const ownerActionDisabledMessage =
    wallet?.type === "ledger"
      ? "Ledger doesn’t support transfer function currently."
      : isLoading
        ? "Verifying ownership on-chain…"
        : !record
          ? (reason ?? "Could not verify this name on-chain.")
          : !isOwner
            ? "You do not own this name."
            : undefined;

  return (
    <div className="flex h-full flex-col p-4">
      <Header
        title={name ?? ""}
        titleClassName="min-w-0 flex-1 break-words text-center tracking-[0.1px] text-[#e5e7eb]"
        showClose={false}
        onBack={() => navigate("/dashboard")}
      />

      {detail && (
        // The action bar is pinned and the content above it scrolls. A plain
        // flex column has min-height:auto, so it grew past the 600px popup and
        // put the Transfer button 21px below the fold with nothing to scroll --
        // the same overflow KNSAsset already fixes this way.
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
          <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto">
            {/* Clicking the hero copies the domain. Copy owns the click and the
              "Copied" tooltip, so the card's own handler stays empty.
              No isVerified: INS exposes no verification flag, so the badge must
              stay absent rather than assert "verified" for every INS name. */}
            <Copy textToCopy={name ?? ""} id="copy-ins-name" place="top">
              <NameCard
                size="lg"
                name={name ?? ""}
                source="igra"
                onClick={() => {}}
              />
            </Copy>

            {/* Mirrors mobile's NameDetailPage: a "Details" heading over one
              list, and a row with no value is hidden rather than shown as a
              dash -- so a Forever name has no Expiry row at all. */}
            <div className="flex w-full flex-col gap-2">
              <h2 className="text-base font-semibold text-daintree-300">
                Details
              </h2>
              <DetailList>
                {detail.owner && (
                  <DetailRow label="Owner">
                    {/* INS resolves against a hardcoded mainnet API, so the
                      Igra mainnet explorer is the only matching destination. */}
                    <ExplorerLink
                      label="View owner in explorer"
                      url={`${igraMainnet.blockExplorers.default.url}/address/${detail.owner}`}
                    />
                    <span className="cursor-pointer">
                      <HoverShowAllCopy
                        text={detail.owner}
                        id="hover-show-all-copy-ins-owner"
                        tooltipWidth="20rem"
                        place="bottom-end"
                      >
                        {textEllipsis(detail.owner)}
                      </HoverShowAllCopy>
                    </span>
                  </DetailRow>
                )}

                {/* Ownership and routing are separate on INS, and only the
                  Receiver decides where an incoming send lands. Hidden until
                  the on-chain read lands; a failed targetOf reads
                  "Unavailable" so it never looks like "no receiver set". */}
                {record && (
                  <DetailRow label="Receiver">
                    {record.target ? (
                      <span className="cursor-pointer">
                        <HoverShowAllCopy
                          text={record.target}
                          id="hover-show-all-copy-ins-target"
                          tooltipWidth="20rem"
                          place="bottom-end"
                        >
                          {textEllipsis(record.target)}
                        </HoverShowAllCopy>
                      </span>
                    ) : (
                      <span>Unavailable</span>
                    )}
                  </DetailRow>
                )}

                {detail.tenure && (
                  <DetailRow label="Tenure">
                    <span className="capitalize">{detail.tenure}</span>
                  </DetailRow>
                )}

                {detail.registry_version && (
                  <DetailRow label="Registry">
                    <span>{detail.registry_version}</span>
                  </DetailRow>
                )}

                {/* A Forever name reports a null expires_at; everything else
                  is unix SECONDS, so it needs *1000 before Date sees it or
                  every name renders as 1970. */}
                {!!detail.expires_at && (
                  <DetailRow label="Expiry">
                    <span>
                      {new Date(detail.expires_at * 1000).toLocaleString(
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
                  </DetailRow>
                )}
              </DetailList>
            </div>
          </div>

          {/* Pinned: the content above scrolls, these stay reachable. */}
          <div className="w-full shrink-0">
            <TransferButton
              disabledMessage={ownerActionDisabledMessage}
              redirectTo={`/ins/${name}/transfer`}
            />

            {/* The only durable way into set-target. The transfer's Half-done
              screen also links here, but that screen is ephemeral: closing the
              popup, going back to the name, or a receipt timeout that never
              reaches Half-done all lose it -- and "Receiver" above would then
              show a stranger with nothing the owner could do about it.
              Like mobile, it is only offered to someone who can use it; the
              Transfer tooltip above already explains why when it is not. */}
            {!ownerActionDisabledMessage && (
              <button
                type="button"
                onClick={() => navigate(`/ins/${name}/set-target`)}
                className="w-full rounded-full border border-daintree-700 py-3 text-base font-semibold text-white"
              >
                Change Receiving Address
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
