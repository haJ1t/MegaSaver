import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
// This dist ships inside the published CLI tarball, so subsets are checked.
// Instrument Sans only publishes latin + latin-ext, both of which we want
// (Turkish is the planned second locale per CLAUDE.md §11 and needs ğ/ş/ı),
// so the bare entries are already minimal. The serif renders exactly one
// glyph run — the Overview $ figure — so it is pinned to latin (-24KB).
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import "@fontsource/instrument-serif/latin-400.css";
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
