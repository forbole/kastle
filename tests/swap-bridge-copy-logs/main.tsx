import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import "@/entrypoints/main.css";
import Bridge from "@/components/screens/Bridge";

window.__bridge = { emitted: [] };

const router = createMemoryRouter([{ path: "/", element: <Bridge /> }]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ width: 375, height: 600 }}>
    <RouterProvider router={router} />
    <Toaster />
  </div>,
);
