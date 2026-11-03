import { createHash } from "node:crypto";
import { BUILT_IN_AVATAR_IDS, type BuiltInAvatarId, type SceneZoneId } from "@private-voice/shared";
import type { SignalingRoom } from "./room-manager";

const SEAT_ZONES: SceneZoneId[] = ["gameDesk1", "gameDesk2", "gameDesk3", "gameDesk4", "gameDesk5"];

export const getOccupiedAvatarIds = (
  room: SignalingRoom | undefined,
  excludingPeerId?: string,
): Set<BuiltInAvatarId> =>
  new Set(
    room?.peers
      .listPeers()
      .filter((peer) => peer.id !== excludingPeerId && peer.avatarId)
      .map((peer) => peer.avatarId as BuiltInAvatarId) ?? [],
  );

export const getAvailableAvatarIds = (
  room: SignalingRoom | undefined,
  excludingPeerId?: string,
): BuiltInAvatarId[] => {
  const occupied = getOccupiedAvatarIds(room, excludingPeerId);
  return BUILT_IN_AVATAR_IDS.filter((avatarId) => !occupied.has(avatarId));
};

export const resolveSceneZone = (
  occupiedZones: Array<{ peerId: string; sceneZone?: SceneZoneId; disconnectedAt?: number }>,
  peerId: string,
  requestedZone?: SceneZoneId,
): SceneZoneId => {
  if (requestedZone && !SEAT_ZONES.includes(requestedZone)) return requestedZone;
  const occupiedSeats = new Set(
    occupiedZones
      .filter((peer) => peer.peerId !== peerId && !peer.disconnectedAt)
      .map((peer) => peer.sceneZone)
      .filter((zone): zone is SceneZoneId => Boolean(zone && SEAT_ZONES.includes(zone))),
  );
  if (requestedZone && !occupiedSeats.has(requestedZone)) return requestedZone;
  return SEAT_ZONES.find((zone) => !occupiedSeats.has(zone)) ?? "restroomZone";
};

export const normalizeAvatar = (
  avatarDataUrl?: string,
): { avatarDataUrl?: string; avatarHash?: string } => {
  if (!avatarDataUrl || Buffer.byteLength(avatarDataUrl, "utf8") > 128 * 1024) return {};
  return { avatarDataUrl, avatarHash: createHash("sha256").update(avatarDataUrl).digest("hex") };
};
