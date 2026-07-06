import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { readAndStoreToken } from "./lib/auth.js";
import "./styles/tokens.css";

// Bootstrap the bridge token from the launch URL (`/?token=<t>`) before any
// component mounts, so the first /api call already carries it.
readAndStoreToken(window.location, sessionStorage, history.replaceState.bind(history));

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element in index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
