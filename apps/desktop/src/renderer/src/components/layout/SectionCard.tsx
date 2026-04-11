import type { PropsWithChildren } from "react";

import { GlassPanel } from "./GlassPanel";

export const SectionCard = ({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) => (
  <GlassPanel className="p-4 md:p-5">
    <div className="mb-4 flex flex-col gap-1">
      <h3 className="text-[17px] font-semibold text-[#111827]">{title}</h3>
      {description ? <p className="text-sm text-[#667085]">{description}</p> : null}
    </div>
    {children}
  </GlassPanel>
);
