import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "@/entrypoints/main.css";
import {
  ProviderRow,
  TokenSheet,
  type SheetToken,
} from "@/components/swap-bridge/ui";
import SwapFamilyTabs, {
  hasFamilyRow,
  inFamily,
  type SwapFamilyTab,
} from "@/components/screens/asset-selector/SwapFamilyTabs";
import { L1_PROVIDERS } from "@/hooks/swap/l1Providers";
import type { Kcc20Family } from "@/lib/kcc20";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";

type Row = SheetToken & { family?: Kcc20Family };
const params = new URLSearchParams(location.search);
const count = Number(params.get("rows") ?? 6);

// KAS, then alternating Standard and KRON rows, as Swap lists the out side.
const rows: Row[] = [
  { key: "kas", chain: "kaspa", symbol: "KAS", image: kasIcon, balance: "100" },
  ...Array.from({ length: count }, (_, i): Row => {
    const kron = i % 2 === 1;
    return {
      key: `kcc20:${i}`,
      chain: "kaspa",
      symbol: kron ? `KRON${i}` : `STD${i}`,
      address: (kron ? "cd" : "ab").repeat(31) + String(i).padStart(2, "0"),
      family: kron ? "kron-legacy" : "kcc20-standard",
      balance: String(i + 1),
    };
  }),
];

declare global {
  interface Window {
    __swap: { in: string; out?: string; family: SwapFamilyTab };
  }
}
window.__swap = { in: "kas", family: "all" };

function Sheet() {
  const [out, setOut] = useState<string>();
  const [family, setFamily] = useState<SwapFamilyTab>("all");
  window.__swap = { in: "kas", out, family };
  const side = useMemo(
    () => rows.map((t) => ({ ...t, disabled: t.key === "kas" })),
    [],
  );
  return (
    <>
      <p data-testid="pair">
        KAS → {rows.find((r) => r.key === out)?.symbol ?? "none"}
      </p>
      <TokenSheet
        open
        onClose={() => {}}
        chains={[{ key: "kaspa", label: "Kaspa", image: kasIcon }]}
        chain="kaspa"
        onChain={() => {}}
        tokens={side.filter((t) => inFamily(t, family))}
        tabs={
          <SwapFamilyTabs
            value={family}
            onChange={setFamily}
            empty={!hasFamilyRow(side, family)}
          />
        }
        onSelect={(t) => setOut(t.key)}
        recentKey="local:qa"
      />
    </>
  );
}

function Providers() {
  const [chosen, setChosen] = useState("kron");
  return (
    <div data-testid="providers" className="flex flex-col gap-2 p-4">
      {L1_PROVIDERS.map((p) => (
        <ProviderRow
          key={p.id}
          image={p.image}
          name={p.name}
          subtitle={p.id === chosen ? "1 KAS ≈ 13,789 WHALE" : "-"}
          selected={p.id === chosen}
          onClick={() => setChosen(p.id)}
        />
      ))}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div
    id="popup"
    className="relative h-[600px] w-[500px] overflow-hidden bg-icy-blue-950 font-sans text-white"
  >
    {params.get("view") === "providers" ? <Providers /> : <Sheet />}
  </div>,
);
