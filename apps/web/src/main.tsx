import React from "react";
import ReactDOM from "react-dom/client";
import { HistoryDashboard } from "./pages/HistoryDashboard.js";
import { WebViewer } from "./pages/WebViewer.js";
import { PricingPage } from "./pages/Pricing.js";
import "@pinar/ui/styles.css";

function App() {
  const path = window.location.pathname;

  if (path === "/pricing") {
    return <PricingPage />;
  }

  if (path.startsWith("/v/")) {
    const id = path.slice(3);
    return <WebViewer sessionId={id} />;
  }

  return <HistoryDashboard />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
