import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../main.css";
import "@/lib/instrument";
import { LedgerTransportProvider } from "@/contexts/LedgerTransportContext.tsx";

browser.runtime.connect({ name: "popup" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LedgerTransportProvider>
      <App />
    </LedgerTransportProvider>
  </React.StrictMode>,
);
