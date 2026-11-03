import type { AppSettings, WindowsIntegrationStatus } from "@private-voice/shared";
import { Button } from "../base/Button";
import { TraySettingsRows } from "./TraySettingsRows";
import { SettingsSection } from "./SettingsSection";
import { SettingsItemRow } from "./SettingsItemRow";
import { WeatherSettingsCard } from "./WeatherSettingsCard";
import { StorageSettingsCard } from "./StorageSettingsCard";
import { InterfaceSoundVolumeRow } from "./InterfaceSoundVolumeRow";

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
        <InterfaceSoundVolumeRow settings={settings} onChange={onChange} />
        <SettingsItemRow
          label="隐藏快捷方式小箭头和盾牌"
          description="影响整个 Windows，操作时会重启资源管理器；管理员授权仍会弹出，不同系统版本的显示效果可能不同。"
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
              disabled={
                loadingWindows ||
                (!windowsStatus?.iconOverlays.arrowHidden &&
                  !windowsStatus?.iconOverlays.shieldHidden)
              }
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
