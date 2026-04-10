import type { PropsWithChildren } from "react";

export const ModalHost = ({ children }: PropsWithChildren) => (
  <div className="pointer-events-none fixed inset-0 z-40">{children}</div>
);
