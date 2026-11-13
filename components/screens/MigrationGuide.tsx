import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import MigrationGuidePage from "@/ui/popup/bridge/MigrationGuidePage";
import useAnalytics from "@/hooks/useAnalytics";
import { useKcc20Migration } from "@/hooks/useKcc20Migration";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import { migrationRowUrl } from "@/lib/kcc20/migration";

// The KAT URL is derived here from the same source as the Bridge row, never
// taken from router state. No eligible migration (direct URL, account or
// network switch, flag off) → back to Bridge.
export default function MigrationGuide() {
  const navigate = useNavigate();
  const { networkId } = useRpcClientStateful();
  const isMainnet = (networkId ?? NetworkType.Mainnet) === NetworkType.Mainnet;
  const { account } = useWalletManager();
  const { emitKcc20MigrationOpened } = useAnalytics();
  const url = migrationRowUrl(
    useKcc20Migration({ address: account?.address, isMainnet }),
  );

  // useFeatureFlags and useKcc20Migration fill their flags from PostHog in a
  // mount effect, so the first render has no URL even for an eligible wallet,
  // and <Navigate>'s own (child) effect would fire before theirs. Decide only
  // after that effect pass; this one runs after theirs, in the same commit.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);

  if (!url) return settled ? <Navigate to="/bridge" replace /> : null;

  const backToBridge = () => navigate(-1);

  return (
    <MigrationGuidePage
      onBack={backToBridge}
      onClose={backToBridge}
      onOpenKatBridge={() => {
        emitKcc20MigrationOpened("bridge");
        chrome.tabs.create({ url });
      }}
    />
  );
}
