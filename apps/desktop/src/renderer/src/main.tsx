import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import { configureMotionRuntime } from "./features/motion/motionSystem";
import { OverlayPage } from "./pages/OverlayPage";
import "./styles/index.css";

configureMotionRuntime();

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
document.documentElement.classList.toggle("overlay-renderer", isOverlay);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <OverlayPage /> : <App />}
  </React.StrictMode>,
);
