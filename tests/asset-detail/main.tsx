import React from "react";
import ReactDOM from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import "@/entrypoints/main.css";
import "@hackernoon/pixel-icon-library/fonts/iconfont.css";
import KasAsset from "@/components/screens/KasAsset";
import TokenAsset from "@/components/screens/KRC20Asset";
import Erc20Asset from "@/components/screens/Erc20Asset";
import EvmKasAsset from "@/components/screens/EvmKasAsset";
import DotkAsset from "@/components/screens/DotkAsset";
import Kcc20Asset, { Kcc20AssetPending } from "@/components/screens/Kcc20Asset";
import Assets from "@/components/dashboard/Assets";
import AssetSelect from "@/components/screens/asset-selector/AssetSelect";
import TokenDetailPage, {
  TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import { Kcc20HistoryDetail } from "@/components/kcc20-asset/Kcc20History";

const TXID = "0123456789abcdef".repeat(4);

// Token info as mobile lists it; the tabs switch for real.
function TokenInfoHarness() {
  const [tab, setTab] = React.useState<TokenDetailTab>("assetInfo");
  return (
    <TokenDetailPage
      name="WHALE"
      tokenName="Whale Token"
      balance="128,001 WHALE"
      network="kcc20"
      networkName="Kaspa"
      tokenId="ca8a8ed8…94c04"
      decimal="0"
      activeTab={tab}
      onTabChange={setTab}
      history={<p>history body</p>}
      onSend={() => {}}
    />
  );
}

// The activity sheet alone; status=X stands in for a feed that answers it.
function ActivityHarness() {
  const [open, setOpen] = React.useState(true);
  const status = params.get("status") ?? undefined;
  return open ? (
    <div id="popup">
      <button type="button">opener</button>
      <Kcc20HistoryDetail
        row={{
          id: "r1",
          txid: TXID,
          kind: "send",
          direction: "out",
          amount: 5n,
          counterparty: {
            address: "kaspa:qf34f0243",
            label: "f34f0243...e9cad",
          },
          timeMs: Date.UTC(2026, 9, 1, 12),
          approxTime: true,
          status,
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  ) : (
    <span data-testid="closed">closed</span>
  );
}

// Every route the screens leave for renders its own path, so the spec can read it.
function Landed() {
  const { pathname, search } = useLocation();
  return <span data-testid="landed">{pathname + search}</span>;
}

const params = new URLSearchParams(location.search);
const router = createMemoryRouter(
  [
    { path: "/kas-asset", element: <KasAsset /> },
    { path: "/token-asset/:ticker", element: <TokenAsset /> },
    { path: "/erc20-asset/:chainId/:address", element: <Erc20Asset /> },
    { path: "/evm-asset/:chainId", element: <EvmKasAsset /> },
    { path: "/dotk/:name", element: <DotkAsset /> },
    {
      path: "/kcc20/:covenantId",
      // kcc20Pending=1: what the route guard shows while it waits.
      element: params.has("kcc20Pending") ? (
        <Kcc20AssetPending />
      ) : (
        <Kcc20Asset />
      ),
    },
    // As Storybook renders it: no history slot, so History falls back to the
    // explorer link.
    {
      path: "/token-detail-no-history",
      element: (
        <TokenDetailPage
          name="KTEST"
          network="kcc20"
          networkName="Kaspa"
          tokenId="abab…abab"
          activeTab="history"
          onTabChange={() => {}}
          onOpenExplorer={() => {}}
        />
      ),
    },
    { path: "/token-detail-info", element: <TokenInfoHarness /> },
    { path: "/kcc20-activity", element: <ActivityHarness /> },
    {
      path: "/dashboard-assets",
      element: (
        <div className="p-4">
          <Assets />
        </div>
      ),
    },
    { path: "/asset-select", element: <AssetSelect /> },
    { path: "*", element: <Landed /> },
  ],
  { initialEntries: [params.get("route") ?? "/kas-asset"] },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  // As PopupLayout; h=<px> shortens it to check Send never covers content.
  <div
    id="popup"
    className="w-[375px] overflow-hidden bg-icy-blue-950 font-sans text-white"
    style={{ height: Number(params.get("h") ?? 600) }}
  >
    <RouterProvider router={router} />
  </div>,
);
