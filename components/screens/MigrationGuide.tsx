import { Navigate, useLocation, useNavigate } from "react-router-dom";
import MigrationGuidePage from "@/ui/popup/bridge/MigrationGuidePage";
import useAnalytics from "@/hooks/useAnalytics";

// Bridge passes the KAT URL in router state. Opened without it (direct URL) → back to Bridge.
export default function MigrationGuide() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { emitKcc20MigrationOpened } = useAnalytics();
  const url = (state as { url?: string } | null)?.url;

  if (!url) return <Navigate to="/bridge" replace />;

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
