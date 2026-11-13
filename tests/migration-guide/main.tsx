import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, Link } from "react-router-dom";
import MigrationGuide from "@/components/screens/MigrationGuide";

function BridgeStub() {
  useEffect(() => {
    window.__migrationGuide.bridgeMounts++;
  }, []);
  return (
    <div>
      <h1>Bridge stub</h1>
      <Link to="/migration-guide">Open guide</Link>
    </div>
  );
}

function DashboardStub() {
  useEffect(() => {
    window.__migrationGuide.dashboardMounts++;
  }, []);
  return (
    <div>
      <h1>Dashboard stub</h1>
      <Link to="/bridge">Open bridge</Link>
    </div>
  );
}

// History as the popup builds it: dashboard → bridge → guide.
const router = createMemoryRouter(
  [
    { path: "/dashboard", element: <DashboardStub /> },
    { path: "/bridge", element: <BridgeStub /> },
    { path: "/migration-guide", element: <MigrationGuide /> },
  ],
  {
    initialEntries: ["/dashboard", "/bridge", "/migration-guide"],
    initialIndex: 2,
  },
);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
