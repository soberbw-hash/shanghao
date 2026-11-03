import { useEffect, useState } from "react";
import { Check, Mic, Volume2 } from "lucide-react";
import type { AudioDeviceDescriptor, AudioDevicePreset } from "@private-voice/shared";
import { PHONE_MIC_DEVICE_ID } from "../../features/audio/phoneMicSource";
import type { AudioPresetDevices } from "../../features/audio/useAudioDevicePresets";
import { useAudioStore } from "../../store/audioStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../base/Button";

function DeviceOptions({
  devices,
  value,
  input,
}: {
  devices: AudioDeviceDescriptor[];
  value: string;
  input?: boolean;
}) {
  const missing =
    value && value !== PHONE_MIC_DEVICE_ID && !devices.some((device) => device.id === value);
  return (
    <>
      <option value="">系统默认</option>
      {devices
        .filter((device) => device.id !== PHONE_MIC_DEVICE_ID)
        .map((device) => (
          <option key={device.id} value={device.id}>
            {device.label || "未命名设备"}
          </option>
        ))}
      {input && <option value={PHONE_MIC_DEVICE_ID}>手机麦克风</option>}
      {missing && <option value={value}>设备未连接</option>}
    </>
  );
}

export function AudioPresetCard({
  slot,
  preset,
  busy,
  active,
  choose,
  save,
}: {
  slot: 0 | 1;
  preset?: AudioDevicePreset;
  busy: boolean;
  active: boolean;
  choose: (preset: AudioDevicePreset) => Promise<void>;
  save: (slot: 0 | 1, name: string, devices: AudioPresetDevices) => Promise<void>;
}) {
  const current = useSettingsStore.getState().settings;
  const [name, setName] = useState(preset?.name ?? (slot === 0 ? "配置一" : "配置二"));
  const [input, setInput] = useState(
    preset ? (preset.audio.preferredInputDeviceId ?? "") : (current?.preferredInputDeviceId ?? ""),
  );
  const [output, setOutput] = useState(
    preset
      ? (preset.audio.preferredOutputDeviceId ?? "")
      : (current?.preferredOutputDeviceId ?? ""),
  );
  const inputs = useAudioStore((state) => state.inputDevices),
    outputs = useAudioStore((state) => state.outputDevices);
  const savedName = preset?.name,
    savedInput = preset?.audio.preferredInputDeviceId,
    savedOutput = preset?.audio.preferredOutputDeviceId;
  useEffect(() => {
    if (savedName) {
      setName(savedName);
      setInput(savedInput ?? "");
      setOutput(savedOutput ?? "");
    }
  }, [savedName, savedInput, savedOutput]);
  const dirty =
    !preset ||
    name.trim() !== preset.name ||
    input !== (savedInput ?? "") ||
    output !== (savedOutput ?? "");
  return (
    <section
      className={`audio-preset-row${active ? " is-active" : ""}`}
      aria-label={`配置 ${slot + 1}`}
    >
      <button
        type="button"
        className="audio-preset-switch"
        aria-label={`使用${preset?.name ?? name}`}
        aria-pressed={active}
        disabled={busy || dirty || active}
        onClick={() => preset && void choose(preset)}
      />
      <input
        aria-label={`配置 ${slot + 1} 名称`}
        maxLength={24}
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <label>
        <span>
          <Mic size={14} />
          麦克风
        </span>
        <select
          aria-label={`配置 ${slot + 1} 麦克风`}
          value={input}
          title={inputs.find((item) => item.id === input)?.label}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
        >
          <DeviceOptions devices={inputs} value={input} input />
        </select>
      </label>
      <label>
        <span>
          <Volume2 size={14} />
          扬声器
        </span>
        <select
          aria-label={`配置 ${slot + 1} 扬声器`}
          value={output}
          title={outputs.find((item) => item.id === output)?.label}
          disabled={busy}
          onChange={(event) => setOutput(event.target.value)}
        >
          <DeviceOptions devices={outputs} value={output} />
        </select>
      </label>
      <div className="audio-preset-actions">
        <button
          type="button"
          className="audio-preset-state"
          disabled={busy || dirty || active}
          onClick={() => preset && void choose(preset)}
        >
          {dirty ? (
            "先保存配置"
          ) : active ? (
            <>
              <Check size={14} />
              当前使用
            </>
          ) : (
            "切换到此配置"
          )}
        </button>
        <Button
          className="text-xs"
          variant="secondary"
          disabled={busy || !name.trim()}
          onClick={() =>
            void save(slot, name, { input: input || undefined, output: output || undefined })
          }
        >
          保存
        </Button>
      </div>
    </section>
  );
}
