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
import Kcc20Asset from "@/components/screens/Kcc20Asset";

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
    { path: "/kcc20/:covenantId", element: <Kcc20Asset /> },
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
