import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import { OverlayPage } from "./pages/OverlayPage";
import { configureMotionRuntime } from "./features/motion/motionSystem";
import "./styles/index.css";

configureMotionRuntime();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OverlayPage />
  </StrictMode>,
);
