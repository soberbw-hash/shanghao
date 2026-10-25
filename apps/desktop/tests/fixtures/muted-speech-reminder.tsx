import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  RoomLifecycleState,
  type AppSettings,
  type DesktopApi,
  type LocalAudioDiagnostics,
} from "@private-voice/shared";
import { createProcessedMicrophoneStream } from "../../src/renderer/src/features/audio/microphoneProcessor";
import { setAudioSendEnabled } from "../../src/renderer/src/features/audio/audioSendGate";
import { useMutedSpeechReminder } from "../../src/renderer/src/hooks/useMutedSpeechReminder";
import { useAudioStore } from "../../src/renderer/src/store/audioStore";
import { useSettingsStore } from "../../src/renderer/src/store/settingsStore";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useAppStore } from "../../src/renderer/src/store/appStore";

window.desktopApi = {
  app: { writeLog: async () => undefined, notify: async () => undefined },
} as unknown as DesktopApi;
navigator.mediaDevices.getUserMedia = async () => {
  throw Error("physical_capture_forbidden");
};
Object.assign(window, {
  runMutedSpeechProbe: async () => {
    const sourceContext = new AudioContext({
      sampleRate: 48000,
      sinkId: { type: "none" },
    } as AudioContextOptions);
    const oscillator = sourceContext.createOscillator(),
      gain = sourceContext.createGain(),
      input = sourceContext.createMediaStreamDestination();
    oscillator.frequency.value = 700;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(input);
    oscillator.start();
    await sourceContext.resume();
    const processed = await createProcessedMicrophoneStream(input.stream, {
      micEqualizerGains: [0, 0, 0, 0, 0],
      lowCutFrequency: "75",
      isNoiseSuppressionEnabled: false,
      isVoiceEnhancementEnabled: false,
    });
    const track = processed.stream.getAudioTracks()[0]!;
    setAudioSendEnabled(track, false);
    const monitor = sourceContext.createAnalyser(),
      silence = sourceContext.createGain();
    silence.gain.value = 0;
    sourceContext
      .createMediaStreamSource(processed.stream)
      .connect(monitor)
      .connect(silence)
      .connect(sourceContext.destination);
    useSettingsStore.setState({
      settings: {
        isMutedSpeechReminderEnabled: true,
        isUiSoundEnabled: false,
        isSystemNotificationEnabled: false,
      } as AppSettings,
    });
    useRoomStore
      .getState()
      .setRoom({ roomId: "synthetic-muted-room", lifecycleState: RoomLifecycleState.Open });
    useRoomStore.getState().setLocalStream(processed.stream);
    useAudioStore.getState().setAudioState({ isMuted: false, isDeafened: false });
    useAudioStore.getState().toggleMicrophone();
    let diagnosticsCount = 0,
      voiceSamples = 0;
    const off = processed.onDiagnostics((diagnostics) => {
      diagnosticsCount++;
      if (
        (diagnostics.speechProbability ?? 0) >= 0.8 &&
        diagnostics.processingMode === "near_speech"
      )
        voiceSamples++;
      useAudioStore.getState().setLocalDiagnostics(diagnostics as LocalAudioDiagnostics);
    });
    try {
      for (let count = 0; count < 70; count++) {
        if (useAppStore.getState().toasts.some((t) => t.dedupeKey === "muted-speech-reminder"))
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const samples = new Float32Array(monitor.fftSize);
      monitor.getFloatTimeDomainData(samples);
      const outputPeak = Math.max(...samples.map(Math.abs));
      const result = {
        diagnosticsCount,
        voiceSamples,
        reminders: useAppStore
          .getState()
          .toasts.filter((t) => t.dedupeKey === "muted-speech-reminder").length,
        senderStillMuted: !track.enabled && useAudioStore.getState().isMuted,
        outputPeak,
      };
      if (
        result.reminders !== 1 ||
        voiceSamples < 5 ||
        !result.senderStillMuted ||
        outputPeak !== 0
      )
        throw Error("muted VAD integration: " + JSON.stringify(result));
      return result;
    } finally {
      off();
      processed.dispose();
      oscillator.stop();
      monitor.disconnect();
      silence.disconnect();
      await sourceContext.close();
      useRoomStore.getState().setLocalStream(undefined);
      useRoomStore.getState().resetRoom();
    }
  },
});
function Fixture() {
  useMutedSpeechReminder();
  useEffect(() => {
    Object.assign(window, { fixtureReady: true });
  }, []);
  return <p>合成音频，无物理采集</p>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
