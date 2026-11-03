import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal } from "lucide-react";
import { selectAudioDeviceSettings } from "@private-voice/shared";
import {
  useAudioDevicePresets,
  type AudioPresetDevices,
} from "../../features/audio/useAudioDevicePresets";
import { useAudioStore } from "../../store/audioStore";
import { useSettingsStore } from "../../store/settingsStore";
import { AudioPresetCard } from "./AudioPresetCard";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";

export function AudioDevicePresets({
  replaceInput,
  onApplied,
  buttonHost,
  isProcessingBusy,
}: {
  isProcessingBusy?: () => boolean;
  buttonHost?: Element | null;
  replaceInput: (id?: string) => Promise<boolean>;
  onApplied?: (id?: string) => void;
}) {
  const { presets, selected, busy, error, choose, save } = useAudioDevicePresets(
    replaceInput,
    onApplied,
    isProcessingBusy,
  );
  const settings = useSettingsStore((state) => state.settings);
  const matching = settings
    ? presets.filter(
        (preset) =>
          JSON.stringify(preset.audio) === JSON.stringify(selectAudioDeviceSettings(settings)),
      )
    : [];
  const activeSlot = matching.find((preset) => preset.slot === selected)?.slot ?? matching[0]?.slot;
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const available = typeof window.desktopApi.shortcuts.onAudioDevicePresetTriggered === "function";
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    void useAudioStore.getState().refreshDevices();
    return () => element?.close();
  }, [open]);
  const store = async (slot: 0 | 1, name: string, devices: AudioPresetDevices) => {
    setMessage("");
    try {
      await save(slot, name, devices);
      setMessage("配置已保存");
    } catch (failure) {
      setMessage(
        failure instanceof Error && failure.message.includes("restart_required")
          ? "请完全退出并重开上号，加载新版音频配置组件。"
          : "配置未保存，请稍后重试。",
      );
    }
  };
  const trigger = (
    <Button
      variant="ghost"
      className="voice-action-button-with-text"
      disabled={busy || !available}
      onClick={() => {
        setMessage("");
        setOpen(true);
      }}
      title={available ? "同时切换麦克风与耳机，仅影响上号" : "重开上号后可使用音频配置"}
    >
      <SlidersHorizontal className="h-4 w-4" />
      <span className="voice-action-label">{busy ? "处理中…" : "音频配置"}</span>
    </Button>
  );
  return (
    <>
      {buttonHost === undefined ? trigger : buttonHost ? createPortal(trigger, buttonHost) : null}
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="audio-presets-dialog"
            aria-label="音频设备配置"
            onCancel={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (
                  event.clientX < bounds.left ||
                  event.clientX > bounds.right ||
                  event.clientY < bounds.top ||
                  event.clientY > bounds.bottom
                )
                  setOpen(false);
              }
            }}
          >
            <header>
              <h2>音频配置</h2>
              <DialogCloseButton label="关闭音频配置" onClick={() => setOpen(false)} />
            </header>
            <div className="audio-preset-grid">
              {([0, 1] as const).map((slot) => (
                <AudioPresetCard
                  key={slot}
                  slot={slot}
                  preset={presets.find((preset) => preset.slot === slot)}
                  active={slot === activeSlot}
                  busy={busy}
                  choose={choose}
                  save={store}
                />
              ))}
            </div>
            {(error || message) && <p role="status">{error || message}</p>}
          </dialog>,
          document.body,
        )}
    </>
  );
}
