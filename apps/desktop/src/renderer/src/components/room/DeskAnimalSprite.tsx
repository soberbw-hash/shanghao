import type { BuiltInAvatarId, MemberActivity } from "@private-voice/shared";

const rearAvatarModules = import.meta.glob<string>(
  "../../assets/avatars/rear/*-rear.png",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

const rearAvatarSources = Object.entries(rearAvatarModules).reduce(
  (result, [path, source]) => {
    const avatarId = path.match(/\/([^/]+)-rear\.png$/)?.[1] as BuiltInAvatarId | undefined;
    if (avatarId) result[avatarId] = source;
    return result;
  },
  {} as Record<BuiltInAvatarId, string>,
);

export const DeskAnimalSprite = ({
  avatarId,
  activity,
  isSpeaking,
  isMoving,
}: {
  avatarId: BuiltInAvatarId;
  activity: MemberActivity;
  isSpeaking: boolean;
  isMoving: boolean;
}) => {
  const source = rearAvatarSources[avatarId] ?? rearAvatarSources.fox;
  const motionState = isMoving
    ? "moving"
    : isSpeaking
      ? "speaking"
      : activity === "gaming"
        ? "gaming"
        : "idle";

  return (
    <div className={`desk-animal desk-animal-${motionState}`} aria-hidden="true">
      <span className="desk-animal-ground-shadow" />
      <span className="desk-animal-chair-back" />
      <img className="desk-animal-layer desk-animal-body" src={source} alt="" draggable={false} />
      <img className="desk-animal-layer desk-animal-head" src={source} alt="" draggable={false} />
      <img className="desk-animal-layer desk-animal-arm" src={source} alt="" draggable={false} />
      <span className="desk-animal-chair-front" />
    </div>
  );
};
