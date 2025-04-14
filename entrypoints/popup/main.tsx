import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../main.css";
import "@/lib/instrument";

console.log(
  `  /$$   /$$  /$$$$$$   /$$$$$$  /$$$$$$$$ /$$       /$$$$$$$$\n | $$  /$$/ /$$__  $$ /$$__  $$|__  $$__/| $$      | $$_____/\n | $$ /$$/ | $$  \\ $$| $$  \\__/   | $$   | $$      | $$\n | $$$$$/  | $$$$$$$$|  $$$$$$    | $$   | $$      | $$$$$\n | $$  $$  | $$__  $$ \\____  $$   | $$   | $$      | $$__/\n | $$\\  $$ | $$  | $$ /$$  \\ $$   | $$   | $$      | $$\n | $$ \\  $$| $$  | $$|  $$$$$$/   | $$   | $$$$$$$$| $$$$$$$$\n |__/  \\__/|__/  |__/ \\______/    |__/   |________/|________/\n`,
);

browser.runtime.connect({ name: "popup" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
