import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import SendTransaction from "@/components/screens/browser-api/ethereum/send-transaction/SendTransaction";
import { walletSigner } from "./stubs";

// GeneralHeader calls useNavigate; the screen reads its request from
// window.location.search, which the memory router leaves alone.
const router = createMemoryRouter([
  { path: "/", element: <SendTransaction walletSigner={walletSigner} /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
