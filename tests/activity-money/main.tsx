import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import "@/entrypoints/main.css";
import { mapSwapActivity } from "@/lib/activity/mappers";
import Activity from "@/components/screens/Activity";
import { RECORDS } from "./records";

(window as unknown as { __feed: unknown }).__feed = {
  rows: RECORDS.map(mapSwapActivity),
  swapSource: ["swap_history_kcc20_unidentified"],
  bridgeSource: null,
  depositSource: null,
  kurveSource: null,
  error: undefined,
  isRefreshing: false,
  refresh: () => {},
};

const router = createMemoryRouter(
  [{ path: "/activity", element: <Activity /> }],
  { initialEntries: ["/activity?type=swap"] },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ width: 375, height: 600 }}>
    <RouterProvider router={router} />
  </div>,
);
