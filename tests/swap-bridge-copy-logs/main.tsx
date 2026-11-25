import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import "@/entrypoints/main.css";
import Bridge from "@/components/screens/Bridge";
import Swap from "@/components/screens/Swap";

window.__bridge = { emitted: [] };

const Screen =
  new URLSearchParams(location.search).get("screen") === "swap" ? Swap : Bridge;
const router = createMemoryRouter([{ path: "/", element: <Screen /> }]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ width: 375, height: 600 }}>
    <RouterProvider router={router} />
    <Toaster />
  </div>,
);
