import type {
  TemporaryAuthProof,
  TemporaryMemberTicket,
  TemporaryRoomProfile,
  TemporaryRoomVersion,
} from "./temporary-room.types";

type TemporaryCommand =
  | { command: "challenge"; publicKey: string; sessionId?: string }
  | { command: "resolve"; code: string; proof: TemporaryAuthProof }
  | { command: "create"; profile: TemporaryRoomProfile; proof: TemporaryAuthProof }
  | { command: "join"; code: string; profile: TemporaryRoomProfile; proof: TemporaryAuthProof }
  | { command: "resume"; ticket: TemporaryMemberTicket; proof: TemporaryAuthProof }
  | { command: "lock"; locked: boolean; expected: TemporaryRoomVersion }
  | { command: "kick"; memberId: string; expected: TemporaryRoomVersion }
  | { command: "rotate"; expected: TemporaryRoomVersion }
  | { command: "heartbeat" | "leave" | "snapshot" };

export type TemporaryRoomRequest = TemporaryCommand & {
  type: "temporary_room_request";
  version: 1;
  requestId: string;
};
export interface TemporaryRoomResponse {
  type: "temporary_room_response";
  version: 1;
  requestId: string;
  ok: boolean;
  value?: unknown;
  code?: string;
}
