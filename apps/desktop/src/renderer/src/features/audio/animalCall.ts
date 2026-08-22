import type { BuiltInAvatarId } from "@private-voice/shared";

const quickReplyCallUrl = new URL(
  "../../assets/sounds/animals/quick-reply-chirp.wav",
  import.meta.url,
).href;
const shanghaoCallUrl = new URL(
  "../../assets/sounds/animals/quick-reply-shanghao.wav",
  import.meta.url,
).href;

const defaultSound = { url: quickReplyCallUrl, duration: 0.74 } as const;
const shanghaoSound = { url: shanghaoCallUrl, duration: 1.62 } as const;
const SHANGHAO_QUICK_REPLY_GAIN = 10 ** (-5 / 20);

let sharedAudioContext: AudioContext | undefined;
const cachedAudio = new Map<string, HTMLAudioElement>();

const getAudioContext = (): AudioContext => {
  sharedAudioContext ??= new AudioContext();
  return sharedAudioContext;
};

const getTemplate = (url: string): HTMLAudioElement => {
  const cached = cachedAudio.get(url);
  if (cached) return cached;
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  cachedAudio.set(url, audio);
  return audio;
};

export const prepareAnimalCalls = (): void => {
  getTemplate(defaultSound.url);
  getTemplate(shanghaoSound.url);
};

export const playAnimalCall = (
  _avatarId: BuiltInAvatarId = "fox",
  volume = 0.72,
  quickReplyContent = "",
): void => {
  const requestedVolume = Math.max(0, Math.min(1, volume));
  if (requestedVolume <= 0) return;

  try {
    const sound = quickReplyContent.trim() === "上号" ? shanghaoSound : defaultSound;
    const context = getAudioContext();
    const audio = getTemplate(sound.url).cloneNode(true) as HTMLAudioElement;
    const source = context.createMediaElementSource(audio);
    const lowCut = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const envelope = context.createGain();
    const duration = sound.duration;
    const now = context.currentTime + 0.012;

    lowCut.type = "highpass";
    lowCut.frequency.value = 68;
    lowCut.Q.value = 0.7;
    body.type = "lowshelf";
    body.frequency.value = 240;
    body.gain.value = 2.2;
    compressor.threshold.value = -27;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.2;

    // The longer “上号” recording is mastered 5 dB lower than the short chirp;
    // keep that correction local to this asset instead of changing global UI volume.
    const level =
      requestedVolume * 0.92 * (sound === shanghaoSound ? SHANGHAO_QUICK_REPLY_GAIN : 1);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), now + 0.025);
    envelope.gain.setValueAtTime(Math.max(0.0001, level), now + Math.max(0.04, duration - 0.12));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(lowCut);
    lowCut.connect(body);
    body.connect(compressor);
    compressor.connect(envelope);
    envelope.connect(context.destination);
    audio.currentTime = 0;
    void context.resume().catch(() => undefined);
    void audio.play().catch(() => undefined);

    window.setTimeout(
      () => {
        audio.pause();
        source.disconnect();
        lowCut.disconnect();
        body.disconnect();
        compressor.disconnect();
        envelope.disconnect();
      },
      Math.ceil((duration + 0.08) * 1_000),
    );
  } catch {
    // A reminder sound must never interrupt the room or message flow.
  }
};
