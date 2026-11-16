import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import Erc20Send from "@/components/send/evm/erc20-send/Erc20Send";
import { kasplexTestnet } from "@/lib/layer2";
import { TOKEN } from "./stubs";

window.__erc20 = { captured: [], sent: 0 };

const router = createMemoryRouter(
  [{ path: "/:chainId/:tokenId", element: <Erc20Send /> }],
  { initialEntries: [`/0x${kasplexTestnet.id.toString(16)}/${TOKEN}`] },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
