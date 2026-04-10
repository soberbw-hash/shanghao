import type { PropsWithChildren } from "react";

export const DrawerHost = ({ children }: PropsWithChildren) => (
  <div className="pointer-events-none fixed inset-y-0 right-0 z-30 flex">{children}</div>
);
