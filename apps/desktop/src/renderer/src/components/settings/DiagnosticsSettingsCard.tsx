import type { DiagnosticsSnapshot } from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";

export const DiagnosticsSettingsCard = ({
  diagnostics,
  onOpenLogs,
  onExportBundle,
}: {
  diagnostics?: DiagnosticsSnapshot;
  onOpenLogs: () => void;
  onExportBundle: () => void;
}) => (
  <SettingsSection title="日志与诊断" description="出问题时先看这里。">
    <div className="space-y-3">
      <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 text-sm text-[#667085]">
        <div>日志目录：{diagnostics?.logsDirectory || "读取中…"}</div>
        <div className="mt-2">最近导出日志：{diagnostics?.lastExportPath || "还没有导出记录"}</div>
        <div className="mt-2">最近导出诊断包：{diagnostics?.lastBundlePath || "还没有导出记录"}</div>
        <div className="mt-2">更新检查：{diagnostics?.lastUpdateCheckMessage || "还没有检查更新"}</div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onOpenLogs}>
          打开日志目录
        </Button>
        <Button variant="secondary" onClick={onExportBundle}>
          导出诊断包
        </Button>
      </div>
    </div>
  </SettingsSection>
);
