import type { PropsWithChildren } from "react";

import { WindowFrame } from "./WindowFrame";

export const AppShell = ({ children }: PropsWithChildren) => (
  <div className="relative h-screen overflow-hidden bg-transparent p-3 md:p-4">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(77,163,255,0.1),transparent_24%)]" />
    <div className="relative z-10 h-full rounded-[28px] border border-white/70 bg-white/90 shadow-[0_28px_90px_rgba(17,24,39,0.12)]">
      <WindowFrame />
      <div className="h-[calc(100%-62px)]">{children}</div>
    </div>
  </div>
);
