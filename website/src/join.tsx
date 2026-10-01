import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoomInvitePage } from "./RoomInvitePage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <header className="site-header">
      <div className="section-shell header-inner">
        <a className="brand" href="/" aria-label="上号首页">
          <img src="/brand-mark.png" alt="" />
          <span>
            <strong>上号</strong>
            <small>SHANGHAO</small>
          </span>
        </a>
        <a href="/">返回首页</a>
      </div>
    </header>
    <RoomInvitePage />
  </StrictMode>,
);
