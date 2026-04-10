import type { PropsWithChildren } from "react";

import { GlassPanel } from "./GlassPanel";

export const BottomControlDock = ({ children }: PropsWithChildren) => (
  <GlassPanel className="mt-auto flex items-center justify-between gap-3 p-4">
    {children}
  </GlassPanel>
);
