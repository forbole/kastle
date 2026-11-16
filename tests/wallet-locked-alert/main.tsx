import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import WalletLockedAlert from "@/components/screens/full-pages/WalletLockedAlert";

window.__walletLocked = { rejections: [] };
window.addEventListener("unhandledrejection", (e) =>
  window.__walletLocked.rejections.push(String(e.reason)),
);

const router = createMemoryRouter([
  { path: "/", element: <WalletLockedAlert /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
