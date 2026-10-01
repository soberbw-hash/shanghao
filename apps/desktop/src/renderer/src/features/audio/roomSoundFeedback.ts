import {
  MemberPresenceState,
  RoomConnectionState,
  RoomLifecycleState,
  type RoomMember,
  type RoomSummary,
} from "@private-voice/shared";

import type { UiSound } from "./uiSound";

export interface RoomSoundSnapshot {
  room: Pick<
    RoomSummary,
    "roomId" | "signalingUrl" | "lifecycleState" | "connectionState" | "members"
  >;
  isMuted: boolean;
  isDeafened: boolean;
  reconnectAttempt: number;
  remoteScreenSharing: Record<string, boolean>;
}

const stable = (state: RoomConnectionState): boolean =>
  state === RoomConnectionState.Connected || state === RoomConnectionState.WaitingPeer;
const away = (member: RoomMember): boolean =>
  member.sceneZone === "restroomZone" || member.activity === "restroom";
const identity = (member: RoomMember): string => member.userId || member.profileId || member.id;
const present = (members: RoomMember[]): Map<string, RoomMember> =>
  new Map(
    members
      .filter(
        (member) => !member.isEmptySlot && member.presenceState !== MemberPresenceState.Offline,
      )
      .map((member) => [member.isLocal ? "local" : `remote:${identity(member)}`, member]),
  );

/** Observes committed view state only; never owns or changes a room/media resource. */
export class RoomSoundFeedback {
  private previous?: RoomSoundSnapshot;
  private baseline = new Map<string, RoomMember>();
  private episode = false;
  private failurePlayed = false;
  private recoveryTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly read: () => RoomSoundSnapshot,
    private readonly play: (sound: UiSound) => void,
  ) {}

  private cancelRecovery(): void {
    if (this.recoveryTimer !== undefined) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  dispose(): void {
    this.cancelRecovery();
    this.previous = undefined;
    this.baseline.clear();
    this.episode = false;
    this.failurePlayed = false;
  }

  update(): void {
    const next = this.read();
    const previous = this.previous;
    this.previous = next;
    const room = next.room;
    const current = present(room.members);
    const sameSession =
      previous?.room.roomId === room.roomId && previous.room.signalingUrl === room.signalingUrl;
    const isOpen = room.lifecycleState === RoomLifecycleState.Open;
    const wasOpen = previous?.room.lifecycleState === RoomLifecycleState.Open;
    if (!sameSession || room.lifecycleState !== previous?.room.lifecycleState) {
      this.cancelRecovery();
      this.episode = false;
      this.failurePlayed = false;
    }

    const local = current.get("local");
    const previousLocal = this.baseline.get("local");
    const localAwayChanged = Boolean(
      sameSession &&
      isOpen &&
      wasOpen &&
      local &&
      previousLocal &&
      away(local) !== away(previousLocal),
    );
    const leaving = Boolean(wasOpen && (!sameSession || !isOpen));
    const deafenChanged = Boolean(previous && next.isDeafened !== previous.isDeafened);
    if (
      previous &&
      next.isMuted !== previous.isMuted &&
      !localAwayChanged &&
      !leaving &&
      !deafenChanged
    ) {
      this.play(next.isMuted ? "mic-off" : "mic-on");
    }
    if (deafenChanged && !leaving) {
      this.play(next.isDeafened ? "speaker-muted" : "speaker-unmuted");
    }

    if (room.connectionState === RoomConnectionState.Failed) {
      if (!this.failurePlayed) this.play("connection-failed");
      this.failurePlayed = true;
      this.episode = false;
      this.cancelRecovery();
      this.baseline = current;
      return;
    }
    if (!sameSession || !isOpen || !wasOpen) {
      this.baseline = current;
      return;
    }
    if (room.connectionState === RoomConnectionState.Reconnecting || next.reconnectAttempt > 0) {
      this.episode = true;
      this.failurePlayed = false;
      this.cancelRecovery();
    }
    if (this.episode && stable(room.connectionState) && next.reconnectAttempt === 0) {
      if (this.recoveryTimer === undefined) {
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = undefined;
          const currentSnapshot = this.read();
          const currentRoom = currentSnapshot.room;
          if (
            !this.episode ||
            currentRoom.roomId !== room.roomId ||
            currentRoom.signalingUrl !== room.signalingUrl ||
            currentRoom.lifecycleState !== RoomLifecycleState.Open ||
            !stable(currentRoom.connectionState) ||
            currentSnapshot.reconnectAttempt > 0
          )
            return;
          this.episode = false;
          this.failurePlayed = false;
          this.baseline = present(currentRoom.members);
          this.play("connection-restored");
        }, 3_000);
      }
    }
    if (!stable(room.connectionState) || this.episode) {
      this.baseline = current;
      return;
    }

    const joined = [...current].some(([key]) => key !== "local" && !this.baseline.has(key));
    const left = [...this.baseline].some(([key]) => key !== "local" && !current.has(key));
    if (joined) this.play("member-join");
    if (left) this.play("member-leave");
    let remoteAway = false;
    let remoteReturn = false;
    for (const [key, member] of current) {
      const before = this.baseline.get(key);
      if (!before || away(before) === away(member)) continue;
      if (key === "local") this.play(away(member) ? "away" : "return");
      else if (away(member)) remoteAway = true;
      else remoteReturn = true;
    }
    if (remoteAway) this.play("member-away");
    if (remoteReturn) this.play("member-return");
    const sharing = next.remoteScreenSharing;
    const beforeSharing = previous.remoteScreenSharing;
    // A departing owner gets a leave cue, not a second share-stop cue.
    const remotePeers = [...current.values()].filter((member) => !member.isLocal);
    if (
      remotePeers.some(
        (member) =>
          sharing[member.id] &&
          !beforeSharing[member.id] &&
          this.baseline.get(`remote:${identity(member)}`)?.id === member.id,
      )
    )
      this.play("screen-share-start");
    if (remotePeers.some((member) => !sharing[member.id] && beforeSharing[member.id]))
      this.play("screen-share-stop");
    this.baseline = current;
  }
}
