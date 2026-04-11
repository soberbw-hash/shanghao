import { Copy } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

export const CopyField = ({ value, onCopy }: { value: string; onCopy?: () => void }) => (
  <div className="flex items-center gap-3">
    <Input value={value} readOnly />
    <Button
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        onCopy?.();
      }}
    >
      <Copy className="h-4 w-4" />
      复制
    </Button>
  </div>
);
