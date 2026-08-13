import type { BuiltInAvatarId } from "@private-voice/shared";

const animalCallUrls: Record<BuiltInAvatarId, string> = {
  cat: new URL("../../assets/sounds/animals/cat-meow.wav", import.meta.url).href,
  duck: new URL("../../assets/sounds/animals/duck-quack.wav", import.meta.url).href,
  panda: new URL("../../assets/sounds/animals/panda-bear-growl.wav", import.meta.url).href,
  corgi: new URL("../../assets/sounds/animals/corgi-bark.wav", import.meta.url).href,
  fox: new URL("../../assets/sounds/animals/fox-call.wav", import.meta.url).href,
};

const playbackDuration: Record<BuiltInAvatarId, number> = {
  cat: 0.78,
  duck: 1.75,
  panda: 1.8,
  corgi: 1.4,
  fox: 1.8,
};

let sharedAudioContext: AudioContext | undefined;
const audioCache = new Map<BuiltInAvatarId, HTMLAudioElement>();

const getAudioContext = (): AudioContext => {
  sharedAudioContext ??= new AudioContext();
  return sharedAudioContext;
};

const getTemplate = (avatarId: BuiltInAvatarId): HTMLAudioElement => {
  const cached = audioCache.get(avatarId);
  if (cached) return cached;
  const audio = new Audio(animalCallUrls[avatarId]);
  audio.preload = "auto";
  audio.load();
  audioCache.set(avatarId, audio);
  return audio;
};

export const prepareAnimalCalls = (): void => {
  for (const avatarId of Object.keys(animalCallUrls) as BuiltInAvatarId[]) {
    getTemplate(avatarId);
  }
};

export const playAnimalCall = (avatarId: BuiltInAvatarId = "fox", volume = 0.72): void => {
  const requestedVolume = Math.max(0, Math.min(1, volume));
  if (requestedVolume <= 0) return;

  try {
    const context = getAudioContext();
    const audio = getTemplate(avatarId).cloneNode(true) as HTMLAudioElement;
    const source = context.createMediaElementSource(audio);
    const lowCut = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const envelope = context.createGain();
    const duration = playbackDuration[avatarId];
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

    const level = requestedVolume * 0.92;
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
