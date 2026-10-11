import type { AppSettings } from "@private-voice/shared";
import type { AcquiredAudioSource } from "./audioSource";
import { getRemoteAudioMixer } from "./RemoteAudioMixer";
import { createProcessedMicrophoneStream } from "./microphoneProcessor";

/** Initial capture and replacement must retain the same echo/voice protection inputs. */
export const createRoomMicrophoneProcessor = (
  source: AcquiredAudioSource,
  settings?: AppSettings,
) =>
  createProcessedMicrophoneStream(source.stream, {
    micEqualizerGains: settings?.micEqualizerGains ?? [0, 0, 0, 0, 0],
    lowCutFrequency: settings?.lowCutFrequency ?? "75",
    isNoiseSuppressionEnabled: settings?.isNoiseSuppressionEnabled ?? true,
    isVoiceEnhancementEnabled: settings?.isVoiceEnhancementEnabled ?? true,
    microphoneSendVolume: settings?.microphoneSendVolume ?? 1,
    getRemoteReferenceLevel: () => getRemoteAudioMixer().getRemoteReferenceLevel(),
    stopInputOnDispose: source.stopInputOnDispose,
  });
