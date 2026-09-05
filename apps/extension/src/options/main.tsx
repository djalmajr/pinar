import React from "react";
import ReactDOM from "react-dom/client";
import { AccountStatesPreview } from "./AccountStatesPreview.js";
import { OptionsApp } from "./OptionsApp.js";
import "@pinar/ui/styles.css";
import "./options.css";

const previewAccountStates = new URLSearchParams(window.location.search).get("states") === "account";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {previewAccountStates ? <AccountStatesPreview /> : <OptionsApp />}
  </React.StrictMode>,
);
