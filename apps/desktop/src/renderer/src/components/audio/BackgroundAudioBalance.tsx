import { useRef, useState } from "react";
import {
  useBackgroundAudioBalanceState,
  acceptBackgroundAudioState,
} from "../../features/audio/backgroundAudioBalance";
import { Switch } from "../base/Switch";
import { ShortcutInput } from "../base/ShortcutInput";
import { SettingsItemRow } from "../settings/SettingsItemRow";

export const BackgroundAudioBalanceSwitch = () => {
  const { enabled, available, phase } = useBackgroundAudioBalanceState();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  return (
    <div className="audio-control-processing-option" data-audio-setting="background-balance">
      <span>
        <strong>平滑背景声音</strong>
        <small>
          {error ||
            (!available
              ? "声音调节组件暂不可用"
              : enabled && phase === "recovering"
                ? "音量调节异常，正在自动恢复"
                : enabled && phase === "waiting"
                  ? "未检测到可调节的背景声音"
                  : enabled && phase === "balancing"
                    ? "正在降低背景音量"
                    : "说话时降低游戏、音乐和视频音量")}
        </small>
      </span>
      <Switch
        ariaLabel="平滑背景声音"
        isChecked={enabled}
        isDisabled={busy || (!available && !enabled)}
        onChange={(value) => {
          const api = window.desktopApi.backgroundAudio;
          if (!api || pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          void api
            .configure({ enabled: value })
            .then(acceptBackgroundAudioState)
            .catch(() => setError("未能切换，请稍后重试"))
            .finally(() => {
              pending.current = false;
              setBusy(false);
            });
        }}
      />
    </div>
  );
};

export const BackgroundAudioBalanceShortcut = () => {
  const { shortcut, available } = useBackgroundAudioBalanceState();
  const [error, setError] = useState("");
  return (
    <SettingsItemRow
      label="背景声音平衡快捷键"
      description={error || "开启或关闭平滑背景声音；使用 Ctrl＋Shift／Alt＋F1～F12。"}
    >
      <ShortcutInput
        value={shortcut}
        defaultValue=""
        compact
        onChange={(value) => {
          const api = window.desktopApi.backgroundAudio;
          if (!api || (!available && value)) {
            setError("当前设备暂不可用。");
            return;
          }
          setError("");
          void api
            .configure({ shortcut: value })
            .then(acceptBackgroundAudioState)
            .catch(() => setError("快捷键被占用或组合不受支持，请换一组。"));
        }}
      />
    </SettingsItemRow>
  );
};
