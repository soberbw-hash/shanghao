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
  error: thinking,
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
  const image = (
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
  return mood === "error" ? (
    <span className="assistant-bot-error" role="img" aria-label="小助手遇到了问题">
      {image}
      <b aria-hidden="true">!</b>
    </span>
  ) : (
    image
  );
};
