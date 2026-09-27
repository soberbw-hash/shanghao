import type { PropsWithChildren, ReactNode } from "react";

import { GlassPanel } from "./GlassPanel";

export const SectionCard = ({
  title,
  description,
  headerAction,
  children,
}: PropsWithChildren<{ title: string; description?: string; headerAction?: ReactNode }>) => (
  <GlassPanel className="settings-section-card p-4 md:p-5">
    <div className="settings-section-heading mb-4 flex flex-col gap-1">
      {headerAction ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#111827]">{title}</h3>
          {headerAction}
        </div>
      ) : (
        <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#111827]">{title}</h3>
      )}
      {description ? <p className="text-sm text-[#667085]">{description}</p> : null}
    </div>
    {children}
  </GlassPanel>
);
