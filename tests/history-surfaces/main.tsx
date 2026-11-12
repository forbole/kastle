import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import "@/entrypoints/main.css";
import "@hackernoon/pixel-icon-library/fonts/iconfont.css";
import KasHistory from "@/components/kas-asset/KasHistory";
import TokenHistory from "@/components/krc20-asset/TokenHistory";
import { Kcc20History } from "@/components/kcc20-asset/Kcc20History";
import { useEvmHistory } from "@/hooks/evm/useEvmHistory";
import type { Kcc20Token } from "@/lib/kcc20";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import EvmKasAsset from "@/components/screens/EvmKasAsset";
import Erc20Asset from "@/components/screens/Erc20Asset";
import { EVM_CHAIN, EVM_OWNER, OWNER } from "./stubs";

const token: Kcc20Token = {
  covenantId: "ab".repeat(32),
  family: "kcc20-standard",
  tick: "ktest",
  amount: 1_000_000n,
  spendable: 1_000_000n,
  meta: { symbol: "KTEST", name: "Kastle test", decimals: 2 },
};

// As EvmKasAsset wires it: the hook's records straight into the shell.
function EvmHistory() {
  const h = useEvmHistory({
    chainId: EVM_CHAIN,
    address: EVM_OWNER,
    source: { family: "evm-native" },
  });
  return (
    <HistoryList
      records={h.records}
      isLoading={h.isLoading}
      isLoadingMore={h.isFetchingMore}
      error={h.error}
      hasMore={h.hasMore}
      onLoadMore={h.loadMore}
      onRetry={h.retry}
    />
  );
}

const params = new URLSearchParams(location.search);
const router = createMemoryRouter(
  [
    { path: "/kas", element: <KasHistory /> },
    { path: "/krc20/:ticker", element: <TokenHistory /> },
    { path: "/kcc20", element: <Kcc20History address={OWNER} token={token} /> },
    { path: "/evm", element: <EvmHistory /> },
    // The two real EVM screens, which pass the designed row's extras.
    { path: "/evm-kas/:chainId", element: <EvmKasAsset /> },
    { path: "/erc20/:chainId/:address", element: <Erc20Asset /> },
  ],
  { initialEntries: [params.get("route") ?? "/kas"] },
);

// Drives in-app navigation (a route param change) from the spec.
(window as unknown as { __harnessNavigate: unknown }).__harnessNavigate =
  router.navigate;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div
    id="popup"
    className="w-[500px] bg-icy-blue-950 p-4 font-sans text-white"
    style={{ minHeight: 600 }}
  >
    <RouterProvider router={router} />
  </div>,
);
