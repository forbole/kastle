import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCopyToClipboard } from "usehooks-ts";
import TokenDetailPage, {
  TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import { explorerAddressLinks } from "@/components/screens/Settings";
import { NetworkType } from "@/contexts/SettingsContext";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { setPopupPath, textEllipsis } from "@/lib/utils";

export default function Kcc20Asset() {
  const navigate = useNavigate();
  const { covenantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  // A token id can have one row per extension commitment; the route names the row.
  const rowExt = searchParams.get("ext");
  const { account } = useWalletManager();
  const { networkId } = useRpcClientStateful();
  const { data: tokens } = useKcc20Tokens(account?.address);
  const [activeTab, setActiveTab] = useState<TokenDetailTab>("history");
  const [, copy] = useCopyToClipboard();

  const token = tokens?.find(
    (t) =>
      t.covenantId === covenantId &&
      (!rowExt || t.extensionCommitment === rowExt),
  );
  const meta = token?.meta;
  // The route guard rules out Ledger; only verified, owned pieces are sendable.
  const canSend = !!meta && !!token && token.spendable > 0n;
  const explorer = explorerAddressLinks[networkId ?? NetworkType.Mainnet];

  useEffect(() => {
    setPopupPath();
  }, []);

  const toDashboard = () => navigate("/dashboard");

  return (
    <TokenDetailPage
      name={meta?.symbol ?? textEllipsis(covenantId)}
      logo={meta?.logoURI}
      network="kcc20"
      networkName="Kaspa"
      tokenId={textEllipsis(covenantId)}
      onTokenIdPress={() => copy(covenantId)}
      isVerified={!!meta && !meta.unverified}
      decimal={meta ? String(meta.decimals) : undefined}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onOpenExplorer={
        explorer && account
          ? () => browser.tabs.create({ url: `${explorer}${account.address}` })
          : undefined
      }
      onSend={
        canSend
          ? () =>
              navigate(
                `/kcc20/send/${covenantId}${rowExt ? `?ext=${rowExt}` : ""}`,
              )
          : undefined
      }
      onBack={toDashboard}
      onClose={toDashboard}
    />
  );
}
