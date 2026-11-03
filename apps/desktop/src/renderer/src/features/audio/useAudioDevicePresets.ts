import { useEffect, useRef, useState } from "react";
import {
  normalizeAudioDevicePresets,
  selectAudioDeviceSettings,
  PushToTalkState,
  RoomConnectionState,
  type AudioDevicePreset,
} from "@private-voice/shared";
import { useSettingsStore } from "../../store/settingsStore";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useAppStore } from "../../store/appStore";
import { applyAudioDevicePreset } from "./audioPresetTransaction";
import { getRemoteAudioMixer } from "./RemoteAudioMixer";
import { holdAudioSend, setAudioSendEnabled } from "./audioSendGate";
import { PHONE_MIC_DEVICE_ID, phoneMicSource } from "./phoneMicSource";

export type AudioPresetDevices = { input?: string; output?: string };

export function useAudioDevicePresets(
  replaceInput: (id?: string) => Promise<boolean>,
  applied?: (id?: string) => void,
  isProcessingBusy?: () => boolean,
) {
  const presets = useSettingsStore((store) => store.settings?.audioDevicePresets);
  const shortcut = useSettingsStore((store) => store.settings?.audioDevicePresetShortcut ?? "");
  const roomId = useRoomStore((store) => store.room.roomId);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [selected, setSelected] = useState<0 | 1>();
  const [error, setError] = useState("");
  const active = useRef<{ release?: () => void } | undefined>(undefined);
  const lifetime = useRef({ active: true });
  const latest = useRef({ replaceInput, applied, isProcessingBusy });
  latest.current = { replaceInput, applied, isProcessingBusy };
  useEffect(() => {
    const owner = { active: true };
    lifetime.current = owner;
    return () => {
      owner.active = false;
      active.current?.release?.();
      active.current = undefined;
    };
  }, []);
  useEffect(() => {
    setBusy(false);
    setError("");
    setSelected(undefined);
    return () => {
      active.current?.release?.();
      active.current = undefined;
    };
  }, [roomId]);
  const choose = async (preset: AudioDevicePreset) => {
    if (active.current || savingRef.current) return;
    const owner = lifetime.current;
    const operation: { release?: () => void } = {};
    active.current = operation;
    setBusy(true);
    setError("");
    const room = useRoomStore.getState().room;
    const peerId = room.members.find((member) => member.isLocal)?.id;
    const sameRoom = () =>
      owner.active &&
      useRoomStore.getState().room.roomId === room.roomId &&
      useRoomStore.getState().room.members.some((member) => member.isLocal && member.id === peerId);
    const before = useAudioStore.getState();
    const mixer = getRemoteAudioMixer();
    const output = async (deviceId?: string) => {
      mixer.getFinalOutputStream();
      await mixer.setOutputDevice(deviceId);
      const result = mixer.getDiagnostics();
      if (
        result.outputRouteStatus !== "applied" ||
        result.appliedOutputDeviceId !== (deviceId || "default")
      )
        throw Error("audio_preset_output_failed");
    };
    try {
      if (before.phoneModeActive) throw Error("audio_preset_phone_active");
      if (latest.current.isProcessingBusy?.()) throw Error("audio_preset_processing_busy");
      await useAudioStore.getState().refreshDevices();
      await applyAudioDevicePreset(preset, {
        getSettings: () => useSettingsStore.getState().settings,
        ownsRoom: () =>
          sameRoom() &&
          active.current === operation &&
          [RoomConnectionState.Connected, RoomConnectionState.WaitingPeer].includes(
            useRoomStore.getState().room.connectionState,
          ),
        ownsSettings: () => owner.active && active.current === operation,
        validateDevices: (candidate) => {
          const devices = useAudioStore.getState();
          const inputId = candidate.audio.preferredInputDeviceId,
            outputId = candidate.audio.preferredOutputDeviceId;
          if (inputId === PHONE_MIC_DEVICE_ID) {
            if (
              !phoneMicSource
                .getStream()
                ?.getAudioTracks()
                .some((track) => track.readyState === "live")
            )
              throw Error("audio_preset_phone_missing");
          } else if (inputId && !devices.inputDevices.some((device) => device.id === inputId))
            throw Error("audio_preset_input_missing");
          else if (!inputId && !devices.inputDevices.length)
            throw Error("audio_preset_input_missing");
          if (outputId && !devices.outputDevices.some((device) => device.id === outputId))
            throw Error("audio_preset_output_missing");
          if (!outputId && !devices.outputDevices.length)
            throw Error("audio_preset_output_missing");
        },
        hold: () => {
          const release = holdAudioSend(useRoomStore.getState().localStream?.getAudioTracks()[0]);
          operation.release = release;
          return release;
        },
        save: (patch) => useSettingsStore.getState().saveSettings(patch),
        input: (id) => latest.current.replaceInput(id),
        output,
        commit: (candidate) => {
          const audio = useAudioStore.getState();
          if (audio.phoneModeActive) throw Error("audio_preset_phone_active");
          audio.setAudioState({
            isMuted: before.isMuted || audio.isMuted || candidate.microphoneMuted,
            isDeafened: before.isDeafened || audio.isDeafened || candidate.speakerMuted,
            isManuallyMuted: audio.isManuallyMuted,
          });
          mixer.setMasterVolume(candidate.audio.speakerMasterVolume);
          latest.current.applied?.(candidate.audio.preferredInputDeviceId);
        },
        restoreGate: (safe) => {
          if (!sameRoom() || active.current !== operation) return;
          const state = useAudioStore.getState();
          if (!safe) state.setMuted(true);
          const current = useAudioStore.getState();
          const track = useRoomStore.getState().localStream?.getAudioTracks()[0];
          if (track)
            setAudioSendEnabled(
              track,
              safe &&
                !current.isMuted &&
                !current.isDeafened &&
                !current.phoneModeActive &&
                !current.listenOnly &&
                (!current.isPushToTalkEnabled ||
                  current.pushToTalkState === PushToTalkState.Pressed),
            );
        },
      });
      if (owner.active && active.current === operation) {
        setSelected(preset.slot);
        useAppStore.getState().pushToast({
          tone: "success",
          title: "已切换到" + preset.name,
          description: "输入和输出设备已就绪，原有静音保持。",
          dedupeKey: "audio-preset",
        });
      }
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      const message = code.includes("phone_missing")
        ? "请先连接手机麦克风。"
        : code.includes("phone_active")
          ? "请先退出电话模式，再切换音频配置。"
          : code.includes("processing_busy")
            ? "正在调整麦克风，请稍后再切换配置。"
            : code.includes("input_missing")
              ? "这套配置的麦克风已断开，请重新连接或覆盖保存。"
              : code.includes("output_missing")
                ? "这套配置的耳机／音箱已断开，请重新连接或覆盖保存。"
                : code.includes("room_changed")
                  ? "房间连接已变化，请连接恢复后再切换。"
                  : code.includes("superseded")
                    ? "声音设置刚刚发生变化，请重新选择配置。"
                    : "设备切换未完成；已尝试恢复原配置，无法确认时保持静音。";
      if (owner.active && active.current === operation) {
        setError(message);
        useAppStore.getState().pushToast({
          tone: "warning",
          title: "音频配置未切换",
          description: message,
          dedupeKey: "audio-preset",
        });
      }
    } finally {
      operation.release?.();
      if (active.current === operation) {
        active.current = undefined;
        if (owner.active) setBusy(false);
      }
    }
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(
    () =>
      window.desktopApi.shortcuts.onAudioDevicePresetTriggered?.(() => {
        const options = useSettingsStore.getState().settings?.audioDevicePresets ?? [];
        const settings = useSettingsStore.getState().settings;
        const current =
          settings &&
          options.find(
            (preset) =>
              JSON.stringify(preset.audio) === JSON.stringify(selectAudioDeviceSettings(settings)),
          )?.slot;
        const next =
          options.find((preset) => preset.slot !== (current ?? selectedRef.current)) ?? options[0];
        if (next) void chooseRef.current(next);
      }),
    [],
  );
  const save = async (slot: 0 | 1, name: string, devices: AudioPresetDevices) => {
    if (active.current || savingRef.current) throw Error("audio_preset_busy");
    savingRef.current = true;
    const owner = lifetime.current;
    setSaving(true);
    setError("");
    try {
      const settings = useSettingsStore.getState().settings,
        audio = useAudioStore.getState();
      if (!settings) throw Error("settings_unavailable");
      const preset = {
        slot,
        name,
        audio: {
          ...selectAudioDeviceSettings(settings),
          preferredInputDeviceId: devices.input,
          preferredOutputDeviceId: devices.output,
        },
        microphoneMuted: audio.isMuted,
        speakerMuted: audio.isDeafened,
      };
      const next = normalizeAudioDevicePresets([
        ...(settings.audioDevicePresets ?? []).filter((item) => item.slot !== slot),
        preset,
      ]);
      if (!next.some((item) => item.slot === slot)) throw Error("invalid_audio_preset");
      const saved = await useSettingsStore.getState().saveSettings({ audioDevicePresets: next });
      if (JSON.stringify(saved.audioDevicePresets) !== JSON.stringify(next))
        throw Error("audio_presets_restart_required");
    } finally {
      savingRef.current = false;
      if (owner.active) setSaving(false);
    }
  };
  return { presets: presets ?? [], shortcut, selected, busy: busy || saving, error, choose, save };
}
