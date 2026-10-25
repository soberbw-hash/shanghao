import type { TemporaryRoomRuntime } from "./temporary-room-runtime";
type Host = ConstructorParameters<typeof TemporaryRoomRuntime>[0];
/** Local Main hosts inherit no server persistence paths. Public directory metadata shares its server owner. */
export function temporaryRuntimeOptions(options: {
  temporaryReplicaRequest?: Host["replicaRequest"];
  temporaryCommit?: Host["commit"];
  temporaryAuthorityId?: string;
  temporaryOnly?: boolean;
  privateRoomFile?: string;
}) {
  const directoryFile = options.temporaryOnly
    ? undefined
    : (options.privateRoomFile ??
      process.env.ROOM_DIRECTORY_FILE ??
      (process.env.CHAT_HISTORY_FILE
        ? `${process.env.CHAT_HISTORY_FILE}.private-rooms.json`
        : undefined));
  return {
    replicaRequest: options.temporaryReplicaRequest,
    commit: options.temporaryCommit,
    authorityId: options.temporaryAuthorityId,
    creatorDeviceId: options.temporaryOnly ? options.temporaryAuthorityId : undefined,
    directoryFile,
  };
}
