import type { PropsWithChildren } from "react";

import { GlassPanel } from "./GlassPanel";

export const BottomControlDock = ({ children }: PropsWithChildren) => (
  <GlassPanel className="mt-auto flex flex-wrap items-center gap-3 p-3 md:flex-nowrap md:justify-between md:p-4">
    {children}
  </GlassPanel>
);
