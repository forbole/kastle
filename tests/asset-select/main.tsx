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

export const NACHO_COVID = "41".repeat(32);

// The wallet's NACHO holding as standardRowsFor builds it: claimedMeta, no
// logo, issuer-claimed (unverified) and never attested.
const nacho: SendableKcc20Token = {
  covenantId: NACHO_COVID,
  family: "kcc20-standard",
  tick: "",
  amount: 172500267n,
  spendable: 172500267n,
  meta: { symbol: "NACHO", name: "Nacho", decimals: 8, unverified: true },
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
          <Kcc20SelectItem token={nacho} />
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
