import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import "@/entrypoints/main.css";
import Activity from "@/components/screens/Activity";

// Every request hangs: a row on screen can only have come from storage.
window.fetch = () => new Promise(() => {});
const w = window as unknown as { __t0: number; __firstRow?: number };
const page = new URLSearchParams(location.search).get("type") ?? "swap";
new MutationObserver((_, obs) => {
  if (document.querySelector("button:has(> div.relative.size-10)")) {
    w.__firstRow = performance.now() - w.__t0;
    obs.disconnect();
  }
}).observe(document.body, { childList: true, subtree: true });
w.__t0 = performance.now();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <div style={{ width: 375, height: 600 }}>
    <RouterProvider
      router={createMemoryRouter(
        [{ path: "/activity", element: <Activity /> }],
        {
          initialEntries: [`/activity?type=${page}`],
        },
      )}
    />
  </div>,
);
