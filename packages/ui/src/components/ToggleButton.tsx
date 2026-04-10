import type { PropsWithChildren } from "react";

import { Button, type ButtonProps } from "./Button";

export interface ToggleButtonProps extends ButtonProps {
  isActive?: boolean;
}

export const ToggleButton = ({
  isActive,
  variant,
  ...props
}: PropsWithChildren<ToggleButtonProps>) => (
  <Button
    variant={isActive ? "primary" : variant ?? "secondary"}
    aria-pressed={isActive}
    {...props}
  />
);
