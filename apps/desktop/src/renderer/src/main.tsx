import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";

import { App } from "./app/App";
import { configureMotionRuntime } from "./features/motion/motionSystem";
import { OverlayPage } from "./pages/OverlayPage";
import { ScreenShareViewerPage } from "./pages/ScreenShareViewerPage";
import "./styles/index.css";

configureMotionRuntime();

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "1";
const isScreenViewer = new URLSearchParams(window.location.search).get("screenViewer") === "1";
document.documentElement.dataset.renderer = isOverlay
  ? "overlay"
  : isScreenViewer
    ? "screen-viewer"
    : "main";
document.documentElement.classList.toggle("overlay-renderer", isOverlay);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <OverlayPage /> : isScreenViewer ? <ScreenShareViewerPage /> : <App />}
  </React.StrictMode>,
);
