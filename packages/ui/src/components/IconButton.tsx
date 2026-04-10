import type { PropsWithChildren } from "react";

import { Button, type ButtonProps } from "./Button";
import { cn } from "./cn";

export const IconButton = ({
  children,
  className,
  ...props
}: PropsWithChildren<Omit<ButtonProps, "variant" | "isFullWidth">>) => (
  <Button
    variant="secondary"
    className={cn("h-11 w-11 rounded-[14px] px-0", className)}
    {...props}
  >
    {children}
  </Button>
);
