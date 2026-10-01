import type { AppSettings, WindowsIntegrationStatus } from "@private-voice/shared";
import { Button } from "../base/Button";
import { TraySettingsRows } from "./TraySettingsRows";
import { SettingsSection } from "./SettingsSection";
import { SettingsItemRow } from "./SettingsItemRow";
import { WeatherSettingsCard } from "./WeatherSettingsCard";
import { StorageSettingsCard } from "./StorageSettingsCard";

export const GeneralSettingsCard = ({
  settings,
  onChange,
  windowsStatus,
  loadingWindows,
  onIconOverlayChange,
  isActive,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  windowsStatus?: WindowsIntegrationStatus;
  loadingWindows: boolean;
  onIconOverlayChange: (hidden: boolean) => void;
  isActive: boolean;
}) => (
  <div className="space-y-4">
    <SettingsSection title="通用" description="管理窗口与天气位置。">
      <div className="space-y-3">
        <TraySettingsRows settings={settings} onChange={onChange} />
        <SettingsItemRow
          label="Windows 外观实验功能"
          description="隐藏 Windows 桌面所有快捷方式的小箭头；此功能会影响整个 Windows，不会隐藏管理员盾牌。"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={loadingWindows || windowsStatus?.iconOverlays.hidden}
              onClick={() => onIconOverlayChange(true)}
            >
              {loadingWindows ? "读取状态…" : "一键隐藏"}
            </Button>
            <Button
              variant="ghost"
              disabled={loadingWindows || windowsStatus?.iconOverlays.hidden !== true}
              onClick={() => onIconOverlayChange(false)}
            >
              恢复默认
            </Button>
          </div>
        </SettingsItemRow>
        <WeatherSettingsCard settings={settings} onChange={(patch) => void onChange(patch)} />
      </div>
    </SettingsSection>
    <StorageSettingsCard isActive={isActive} />
  </div>
);
