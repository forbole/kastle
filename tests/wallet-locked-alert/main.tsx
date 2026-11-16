import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import WalletLockedAlert from "@/components/screens/full-pages/WalletLockedAlert";

window.__walletLocked = {
  rejections: [],
  openPopup: [],
  openPopupCalls: 0,
  openPopupDelayMs: 0,
};
window.addEventListener("unhandledrejection", (e) =>
  window.__walletLocked.rejections.push(String(e.reason)),
);

const router = createMemoryRouter([
  { path: "/", element: <WalletLockedAlert /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
