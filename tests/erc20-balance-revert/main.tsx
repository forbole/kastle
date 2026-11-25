import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import Erc20Send from "@/components/send/evm/erc20-send/Erc20Send";
import EvmKasSend from "@/components/send/evm/evm-kas-send/EvmKasSend";
import { kasplexTestnet } from "@/lib/layer2";
import { TOKEN } from "./stubs";

window.__erc20 = { captured: [], sent: 0 };

const chainId = `0x${kasplexTestnet.id.toString(16)}`;
// ?flow=kas: the EVM KAS send screen on the same chain
const router = createMemoryRouter(
  [
    { path: "/:chainId/:tokenId", element: <Erc20Send /> },
    { path: "/kas/:chainId", element: <EvmKasSend /> },
  ],
  {
    initialEntries: [
      new URLSearchParams(location.search).get("flow") === "kas"
        ? `/kas/${chainId}`
        : `/${chainId}/${TOKEN}`,
    ],
  },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
