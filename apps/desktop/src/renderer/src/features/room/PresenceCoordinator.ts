import type {
  MemberActivity,
  MusicActivity,
  SceneZoneId,
  WorkActivity,
} from "@private-voice/shared";
import type { MemberStateMessage } from "@private-voice/signaling";

import { normalizePresenceGameIconDataUrl, normalizePresenceGameName } from "./presenceSignal";

interface DesiredPresenceState {
  isDeafened: boolean;
  activity: MemberActivity;
  sceneZone?: SceneZoneId;
  gameName?: string;
  gameIconDataUrl?: string;
  musicActivity?: MusicActivity;
  workActivity?: WorkActivity;
  key: string;
}

interface PresenceCoordinatorOptions {
  roomId: string;
  peerId: string;
  canPublish: () => boolean;
  send: (payload: MemberStateMessage) => Promise<boolean>;
}

/** Coalesces local activity changes and publishes only the newest presence snapshot. */
export class PresenceCoordinator {
  private desired?: DesiredPresenceState;
  private lastPublishedKey?: string;
  private pendingKey?: string;
  private generation = 0;

  constructor(private readonly options: PresenceCoordinatorOptions) {}

  resetPublication(): void {
    this.generation += 1;
    this.lastPublishedKey = undefined;
    this.pendingKey = undefined;
  }

  update(
    isDeafened: boolean,
    activity: MemberActivity,
    sceneZone?: SceneZoneId,
    gameName?: string,
    musicActivity?: MusicActivity,
    gameIconDataUrl?: string,
    workActivity?: WorkActivity,
  ): void {
    const normalizedGameName = normalizePresenceGameName(gameName);
    const normalizedGameIconDataUrl = normalizePresenceGameIconDataUrl(
      normalizedGameName,
      gameIconDataUrl,
    );
    const key = JSON.stringify([
      isDeafened,
      activity,
      sceneZone ?? null,
      normalizedGameName ?? null,
      normalizedGameIconDataUrl ?? null,
      musicActivity ?? null,
      workActivity ?? null,
    ]);
    this.desired = {
      isDeafened,
      activity,
      sceneZone,
      gameName: normalizedGameName,
      gameIconDataUrl: normalizedGameIconDataUrl,
      musicActivity,
      workActivity,
      key,
    };
    void this.publish();
  }

  async publish(): Promise<void> {
    const desired = this.desired;
    if (
      !desired ||
      !this.options.canPublish() ||
      this.lastPublishedKey === desired.key ||
      this.pendingKey
    ) {
      return;
    }

    const publicationGeneration = this.generation;
    this.pendingKey = desired.key;
    const sent = await this.options.send({
      type: "member_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isDeafened: desired.isDeafened,
      activity: desired.activity,
      sceneZone: desired.sceneZone,
      gameName: desired.gameName ?? "",
      gameIconDataUrl: desired.gameIconDataUrl ?? null,
      musicActivity: desired.musicActivity ?? null,
      workActivity: desired.workActivity ?? null,
    });

    if (publicationGeneration !== this.generation) return;
    if (this.pendingKey === desired.key) this.pendingKey = undefined;
    if (sent) this.lastPublishedKey = desired.key;
    if (this.desired?.key !== desired.key) void this.publish();
  }
}
