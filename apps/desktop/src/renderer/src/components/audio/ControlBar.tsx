import type { PropsWithChildren } from "react";

export const ControlBar = ({ children }: PropsWithChildren) => (
  <div className="flex flex-wrap items-center gap-3">{children}</div>
);
