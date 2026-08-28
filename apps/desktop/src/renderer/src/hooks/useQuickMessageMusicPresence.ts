import { useMemo, useSyncExternalStore } from "react";

import type { ActiveQuickMusic } from "@private-voice/shared";

import {
  getQuickMessageAudioSnapshot,
  subscribeQuickMessageAudio,
} from "../features/audio/quickMessageAudio";

export const useActiveQuickMessageMusic = (): ActiveQuickMusic | undefined => {
  const audio = useSyncExternalStore(
    subscribeQuickMessageAudio,
    getQuickMessageAudioSnapshot,
    getQuickMessageAudioSnapshot,
  );

  return useMemo(() => {
    if (
      audio.status !== "playing" ||
      audio.mediaType !== "music" ||
      !audio.sourcePeerId ||
      !audio.quickMessageId ||
      !audio.presetId
    ) {
      return undefined;
    }
    return {
      peerId: audio.sourcePeerId,
      messageId: audio.quickMessageId,
      presetId: audio.presetId,
      nickname: audio.sourceNickname || "好友",
      title: audio.content || "正在播放音乐",
    };
  }, [audio]);
};
