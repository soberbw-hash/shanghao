import type { PropsWithChildren } from "react";

export const Tooltip = ({
  children,
  content
}: PropsWithChildren<{ content: string }>) => (
  <span className="group relative inline-flex">
    {children}
    <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 hidden -translate-x-1/2 rounded-xl border border-white/10 bg-[#111723] px-2 py-1 text-[11px] text-white/75 shadow-xl group-hover:block">
      {content}
    </span>
  </span>
);
