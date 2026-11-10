import ReactDOM from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import "@/entrypoints/main.css";
import Kcc20SelectItem, {
  SendableKcc20Token,
} from "@/components/screens/asset-selector/Kcc20SelectItem";
import { matchesKcc20Search } from "@/components/screens/asset-selector/kcc20Search";

export const NACHO_COVID = "41".repeat(32);

// The wallet's NACHO holding as standardRowsFor builds it: claimedMeta, no
// logo, issuer-claimed (unverified) and never attested.
const params = new URLSearchParams(location.search);
// nameonly=1: a claimed holding with a name and no ticker (symbol "").
const nameOnly = params.has("nameonly");
// q=<text>: the picker's search box, through the picker's own predicate.
const q = params.get("q") ?? "";
const nacho: SendableKcc20Token = {
  covenantId: NACHO_COVID,
  family: "kcc20-standard",
  tick: "",
  amount: 172500267n,
  spendable: 172500267n,
  meta: {
    symbol: nameOnly ? "" : "NACHO",
    name: nameOnly ? "NACHO" : "Nacho",
    decimals: 8,
    // attested=1: the unfilled row carries no `unverified` (the fill still stamps it).
    ...(params.has("attested") ? {} : { unverified: true as const }),
  },
};
(window as unknown as { __row: unknown }).__row = nacho;

function Landed() {
  const { pathname, search } = useLocation();
  return <div data-testid="landed">{pathname + search}</div>;
}

const router = createMemoryRouter(
  [
    {
      path: "/",
      element: (
        <div className="flex flex-col">
          {matchesKcc20Search(nacho, q) && <Kcc20SelectItem token={nacho} />}
          <div data-testid="ready" />
        </div>
      ),
    },
    { path: "*", element: <Landed /> },
  ],
  { initialEntries: ["/"] },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div id="popup" className="w-[375px] bg-icy-blue-950 font-sans text-white">
    <RouterProvider router={router} />
  </div>,
);
