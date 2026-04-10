import type { PropsWithChildren } from "react";

import { WindowFrame } from "./WindowFrame";

export const AppShell = ({ children }: PropsWithChildren) => (
  <div className="relative h-screen overflow-hidden p-4">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(139,211,255,0.12),transparent_30%)]" />
    <div className="relative z-10 h-full rounded-[28px] border border-white/8 bg-[rgba(8,12,18,0.88)] shadow-[0_28px_90px_rgba(0,0,0,0.35)] backdrop-blur-panel">
      <WindowFrame />
      <div className="h-[calc(100%-64px)]">{children}</div>
    </div>
  </div>
);
