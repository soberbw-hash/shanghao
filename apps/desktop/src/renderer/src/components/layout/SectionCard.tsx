import type { PropsWithChildren } from "react";

import { GlassPanel } from "./GlassPanel";

export const SectionCard = ({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) => (
  <GlassPanel className="settings-section-card p-4 md:p-5">
    <div className="settings-section-heading mb-4 flex flex-col gap-1">
      <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#111827]">{title}</h3>
      {description ? <p className="text-sm text-[#667085]">{description}</p> : null}
    </div>
    {children}
  </GlassPanel>
);
