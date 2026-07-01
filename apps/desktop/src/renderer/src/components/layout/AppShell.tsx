import type { PropsWithChildren } from "react";

import { WindowFrame } from "./WindowFrame";

export const AppShell = ({ children }: PropsWithChildren) => (
  <div className="app-shell relative h-screen overflow-hidden">
    <div className="app-shell-ambient" aria-hidden="true" />
    <div className="app-shell-surface relative z-10 h-full">
      <WindowFrame />
      <div className="h-[calc(100%-58px)]">{children}</div>
    </div>
  </div>
);
