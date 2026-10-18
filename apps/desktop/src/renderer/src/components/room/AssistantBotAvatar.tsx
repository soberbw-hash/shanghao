import { useState } from "react";

import gaming from "../../assets/ai/mascot/gaming.png";
import greeting from "../../assets/ai/mascot/greeting.png";
import idle from "../../assets/ai/mascot/idle.png";
import thinking from "../../assets/ai/mascot/thinking.png";
import type { AssistantBotMood } from "../../features/ai/useAssistantBotState";
import { RoomAiIcon } from "./RoomAiIcon";

export const mascotImages: Record<AssistantBotMood, string> = {
  idle,
  greeting,
  thinking,
  speaking: idle,
  gaming,
  error: idle,
};

export const AssistantBotAvatar = ({
  mood,
  size = 34,
}: {
  mood: AssistantBotMood;
  size?: number;
}) => {
  const source = mascotImages[mood];
  const [failedSource, setFailedSource] = useState<string>();

  if (failedSource === source) return <RoomAiIcon />;
  return (
    <img
      src={source}
      className="assistant-bot-image"
      data-mood={mood}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailedSource(source)}
    />
  );
};
