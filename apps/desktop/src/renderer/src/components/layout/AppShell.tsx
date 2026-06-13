import type { PropsWithChildren } from "react";

import { WindowFrame } from "./WindowFrame";

export const AppShell = ({ children }: PropsWithChildren) => (
  <div className="relative h-screen overflow-hidden bg-[#F5F7FA]">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(77,163,255,0.08),transparent_22%)]" />
    <div className="relative z-10 h-full bg-white">
      <WindowFrame />
      <div className="h-[calc(100%-58px)]">{children}</div>
    </div>
  </div>
);
