import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/ui/general/PageHeader";
import Button from "@/ui/general/Button";
import AssetImage from "@/ui/popup/kcc20/AssetImage";
import CurveProgress from "@/ui/popup/kasseal/CurveProgress";
import { KASSEAL_LABELS } from "@/ui/popup/kasseal/labels";
import { useKassealToken } from "@/lib/kasseal/useKassealTokens";
import { curvePercent, formatKas } from "./format";

export default function KassealToken() {
  const navigate = useNavigate();
  const { covenantId } = useParams();
  const { data: token, error, isLoading } = useKassealToken(covenantId);
  const percent = token && curvePercent(token);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={token?.ticker ?? KASSEAL_LABELS.title}
        onBack={() => navigate("/kasseal")}
      />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {isLoading && (
          <p className="py-8 text-center text-sm text-daintree-400">
            {KASSEAL_LABELS.loadingTokens}
          </p>
        )}
        {error && (
          <p className="py-8 text-center text-sm text-daintree-400">
            {KASSEAL_LABELS.loadFailed}
          </p>
        )}
        {token && (
          <>
            <div className="flex items-center gap-3">
              <AssetImage
                variant="chain"
                tokenImage={token.imageUrl}
                fallback={token.ticker}
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-white">
                  {token.name}
                </span>
                <span className="text-xs text-daintree-400">
                  {token.phase === "bonding"
                    ? KASSEAL_LABELS.bonding
                    : KASSEAL_LABELS.graduated}
                </span>
              </div>
            </div>
            {token.description && (
              <p className="text-sm text-daintree-400">{token.description}</p>
            )}
            {percent !== undefined && token.curve && (
              <CurveProgress
                percent={percent}
                raised={`${formatKas(token.curve.raisedSompi)} / ${formatKas(token.curve.targetSompi)}`}
              />
            )}
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-daintree-400">
                  {KASSEAL_LABELS.holders}
                </span>
                <span className="text-white">{token.holders}</span>
              </div>
              {token.marketCapSompi !== undefined && (
                <div className="flex justify-between">
                  <span className="text-daintree-400">
                    {KASSEAL_LABELS.marketCap}
                  </span>
                  <span className="text-white">
                    {formatKas(token.marketCapSompi)}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-auto">
              <Button
                size="lg"
                disabled={token.verification === "invalid"}
                onClick={() => navigate(`/kasseal/${token.covenantId}/trade`)}
              >
                {KASSEAL_LABELS.trade}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
