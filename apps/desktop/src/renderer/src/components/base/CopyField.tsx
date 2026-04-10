import { Copy } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

export const CopyField = ({ value }: { value: string }) => (
  <div className="flex items-center gap-3">
    <Input value={value} readOnly />
    <Button
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value);
      }}
    >
      <Copy className="h-4 w-4" />
      复制
    </Button>
  </div>
);
