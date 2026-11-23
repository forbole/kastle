import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import SendTransaction from "@/components/screens/browser-api/ethereum/send-transaction/SendTransaction";
import { walletSigner } from "./stubs";

// GeneralHeader calls useNavigate; the screen reads its request from
// window.location.search, which the memory router leaves alone.
const router = createMemoryRouter([
  {
    path: "/",
    element: (
      <SendTransaction
        walletSigner={walletSigner}
        // ?wait= shortens the balance-check bound so a spec need not sit
        // through the production one.
        balanceWaitMs={
          Number(new URLSearchParams(location.search).get("wait")) || undefined
        }
      />
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
