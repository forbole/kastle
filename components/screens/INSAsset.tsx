import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import NameCard from "@/components/dashboard/NameCard";
import { DetailList, DetailRow, ExplorerLink } from "@/components/DetailList";
import { igraMainnet } from "@/lib/layer2";
import { useInsResolve } from "@/hooks/ins/useIns";
import { lookupInsNameOnChain } from "@/lib/ins/insRegistry";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import TransferButton from "@/components/nft/TransferButton";
import { numberToHex } from "viem";
import { textEllipsis } from "@/lib/utils";
import Copy from "@/components/Copy";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";

export default function INSAsset() {
  const navigate = useNavigate();
  const { name } = useParams();
  const { detail } = useInsResolve(name);

  // The transfer target is taken from the on-chain lookup, never from the REST
  // record: it returns the registry and the token id together, so the pair is
  // guaranteed to match. V1 and V2 namespace ids separately, so pairing a v2
  // id with the v1 address (or vice versa) would transfer a different asset.
  const [transferTarget, setTransferTarget] = useState<{
    registry: `0x${string}`;
    tokenId: bigint;
  }>();

  // The generic ERC-721 flow only gates Ledger at its entry point
  // (ERC721.tsx), so nothing is inherited by linking to the route -- this
  // screen has to carry the same guard itself.
  const { wallet } = useWalletManager();
  const transferDisabledMessage =
    wallet?.type === "ledger"
      ? "Ledger doesn’t support transfer function currently."
      : !transferTarget
        ? "Verifying this name on-chain…"
        : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!name) return;

    lookupInsNameOnChain(name).then((result) => {
      if (cancelled) return;
      setTransferTarget(
        result.ok
          ? { registry: result.registry, tokenId: result.tokenId }
          : undefined,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [name]);

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
                  {/* A Forever name reports tenure "forever" and a null
                      expires_at; everything else is unix SECONDS, so it needs
                      *1000 before Date sees it or every name renders as 1970. */}
                  {detail.tenure === "forever" || detail.expires_at === 0
                    ? "Never"
                    : detail.expires_at
                      ? new Date(detail.expires_at * 1000).toLocaleString(
                          "en-GB",
                          {
                            month: "short",
                            day: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZoneName: "short",
                          },
                        )
                      : "-"}
                </span>
              </DetailRow>
            </DetailList>
          </div>

          {/* The recipient receives the name, but NOT its routing target:
              transferFrom never touches targetOf, so resolve() keeps pointing
              at the sender until someone calls setTarget. Say so before they
              sign rather than shipping a name that silently misroutes. */}
          <div className="w-full rounded-xl bg-[#102831] p-3 text-sm text-yellow-500">
            Transferring sends the name only. It will keep routing funds to you
            until the new owner sets their own target on it.
          </div>

          <div className="w-full">
            <TransferButton
              disabledMessage={transferDisabledMessage}
              redirectTo={
                transferTarget
                  ? `/erc721/${numberToHex(igraMainnet.id)}/${transferTarget.registry}/${transferTarget.tokenId}/transfer`
                  : ""
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
