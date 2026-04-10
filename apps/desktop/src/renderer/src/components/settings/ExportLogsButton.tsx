import { FileDown } from "lucide-react";

import { Button } from "../base/Button";

export const ExportLogsButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" onClick={onClick}>
    <FileDown className="h-4 w-4" />
    导出日志
  </Button>
);
