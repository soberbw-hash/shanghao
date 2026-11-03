import { useRef, useState } from "react";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useAppStore } from "../../store/appStore";

/** Recovery is explicit; changing a device cannot silently open an away/phone microphone. */
export function useListenOnlyRecovery(
  replace: (deviceId?: string) => Promise<boolean>,
  deviceId?: string,
) {
  const listenOnly = useAudioStore((state) => state.listenOnly);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const recoverMicrophone = () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const roomId = useRoomStore.getState().room.roomId;
    void replace(deviceId)
      .then((switched) => {
        const audio = useAudioStore.getState();
        if (
          switched &&
          useRoomStore.getState().room.roomId === roomId &&
          !audio.isDeafened &&
          !audio.phoneModeActive
        )
          audio.setMuted(false);
      })
      .catch(() => undefined)
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  };
  const notice = listenOnly ? (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 rounded-xl bg-[#fff7e7] px-3 py-2 text-xs text-[#85612f]"
    >
      <span>麦克风暂不可用，当前可听和聊天。</span>
      <button
        type="button"
        disabled={busy}
        className="font-semibold disabled:opacity-50"
        onClick={recoverMicrophone}
      >
        {busy ? "正在连接…" : "重新连接麦克风"}
      </button>
    </div>
  ) : null;
  const toggleMicrophone = () => {
    if (useAudioStore.getState().listenOnly) return recoverMicrophone();
    const audio = useAudioStore.getState();
    if (audio.isDeafened && audio.isMuted) {
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "先打开扬声器后才能开麦。",
        description: "关闭扬声器时会同时关闭麦克风。",
      });
      return;
    }
    audio.toggleMicrophone();
  };
  return { toggleMicrophone, notice };
}
