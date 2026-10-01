/** The recording owner seals its current room before another session can publish audio. */
let owner: { roomId: string; finish: () => Promise<void> } | undefined;
let finishing: Promise<void> | undefined;

export const registerRoomRecordingFinalizer = (
  roomId: string,
  finish: () => Promise<void>,
): (() => void) => {
  const registration = { roomId, finish };
  owner = registration;
  return () => {
    if (owner === registration) owner = undefined;
  };
};

export const finishRoomRecordingBeforeRelease = (): Promise<void> => {
  if (finishing) return finishing;
  if (!owner) return Promise.resolve();
  const captured = owner;
  const operation = Promise.resolve().then(() => captured.finish());
  finishing = operation;
  void operation.then(
    () => {
      if (finishing === operation) finishing = undefined;
    },
    () => {
      if (finishing === operation) finishing = undefined;
    },
  );
  return operation;
};
