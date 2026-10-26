import { useRef, useState } from "react";
import { Phone } from "lucide-react";
import { useAudioStore } from "../../store/audioStore";
import { useAppStore } from "../../store/appStore";
import { desktopApi } from "../../utils/desktopApi";

/** Mouse interaction is always a toggle; keyboard trigger preferences stay independent. */
export const PhoneModeButton = ({ canUse }: { canUse: boolean }) => {
  const active = useAudioStore((state) => state.phoneModeActive);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const toggle = async () => {
    if (!canUse || pending.current || !desktopApi?.phoneMode) return;
    pending.current = true;
    setBusy(true);
    try {
      await desktopApi.phoneMode.set(!useAudioStore.getState().phoneModeActive);
      // The shared onChanged listener owns the confirmed phone state and sound cues.
    } catch {
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "电话模式未能切换",
        description: "请稍后重试；当前麦克风状态会保留。",
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      disabled={!canUse || busy || !desktopApi?.phoneMode}
      aria-pressed={Boolean(active)}
      title={active ? "结束电话 · 恢复之前状态" : "电话模式 · 点击开启，再点关闭"}
      onClick={() => void toggle()}
    >
      <Phone aria-hidden="true" />
      电话
    </button>
  );
};
