import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import { OverlayPage } from "./pages/OverlayPage";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("overlay") === "1" ? <OverlayPage /> : <App />}
  </React.StrictMode>,
);
