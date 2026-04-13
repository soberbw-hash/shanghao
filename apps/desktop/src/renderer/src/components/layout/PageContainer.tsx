import type { PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const PageContainer = ({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) => (
  <div className={cn("flex h-full flex-col gap-2.5 px-4 py-2.5", className)}>{children}</div>
);
