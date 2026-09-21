import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { SWRConfig } from "swr";
import NftList from "@/components/dashboard/NftList";
import KRC721 from "@/components/screens/KRC721";

const params = new URLSearchParams(location.search);
window.__h = {
  networkId: params.get("network") ?? "mainnet",
  address: params.get("address") ?? "kaspa:owner",
  walletType: params.get("wallet") ?? "software",
  erc721Pages: JSON.parse(params.get("erc721") ?? "[]"),
};

const router = createMemoryRouter(
  [
    { path: "/grid", element: <NftList /> },
    { path: "/krc721/:tick/:tokenId", element: <KRC721 /> },
  ],
  { initialEntries: [params.get("route") ?? "/grid"] },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <div id="popup">
      <RouterProvider router={router} />
    </div>
  </SWRConfig>,
);
