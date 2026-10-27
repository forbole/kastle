import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/ui/general/PageHeader";
import TokenRow from "@/ui/popup/kasseal/TokenRow";
import { KASSEAL_LABELS } from "@/ui/popup/kasseal/labels";
import useKassealTokens from "@/lib/kasseal/useKassealTokens";
import { curvePercent, formatKas } from "./format";

export default function KassealBrowse() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const {
    data: tokens,
    error,
    isLoading,
  } = useKassealTokens(search.trim() || undefined);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={KASSEAL_LABELS.title}
        onBack={() => navigate("/dashboard")}
      />
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={KASSEAL_LABELS.searchPlaceholder}
          className="rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-3 text-sm text-white outline-none"
        />
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
        {tokens?.length === 0 && (
          <p className="py-8 text-center text-sm text-daintree-400">
            {KASSEAL_LABELS.noTokens}
          </p>
        )}
        {tokens
          // Invalid launches are never offered for trading.
          ?.filter((t) => t.verification !== "invalid")
          .map((t) => (
            <TokenRow
              key={t.covenantId}
              name={t.name}
              ticker={t.ticker}
              logo={t.imageUrl}
              progress={curvePercent(t)}
              marketCap={
                t.marketCapSompi !== undefined
                  ? formatKas(t.marketCapSompi)
                  : undefined
              }
              onClick={() => navigate(`/kasseal/${t.covenantId}`)}
            />
          ))}
      </div>
    </div>
  );
}
