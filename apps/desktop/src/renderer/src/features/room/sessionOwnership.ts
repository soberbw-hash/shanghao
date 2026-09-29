export type RoomSessionEvent =
  | "join_requested"
  | "microphone_acquire_started"
  | "microphone_acquired"
  | "connect_started"
  | "connected"
  | "join_failed"
  | "leave_requested"
  | "leave_completed"
  | "disconnect_started"
  | "disconnect_completed"
  | "disconnect_superseded"
  | "reconnect_attempt"
  | "reconnect_exhausted"
  | "device_switch_started"
  | "device_switch_applied"
  | "device_switch_discarded"
  | "device_switch_failed";

export interface RoomSessionTimelineEntry {
  at: string;
  generation: number;
  event: RoomSessionEvent;
}

/** A generation changes whenever a room join or leave takes ownership of the UI. */
export class RoomSessionOwnership {
  private generation = 0;
  private readonly timeline: RoomSessionTimelineEntry[] = [];
  private droppedEvents = 0;
  private readonly timelineCapacity = 120;
  private readonly timelineRetentionMs = 10 * 60_000;

  current(): number {
    return this.generation;
  }

  advance(): number {
    this.generation += 1;
    return this.generation;
  }

  owns(generation: number): boolean {
    return this.generation === generation;
  }

  ownsPeer(generation: number, expectedPeerId: string, activePeerId?: string): boolean {
    return this.owns(generation) && activePeerId === expectedPeerId;
  }

  record(event: RoomSessionEvent, generation = this.generation, now = Date.now()): void {
    this.timeline.push({ at: new Date(now).toISOString(), generation, event });
    this.prune(now);
  }

  snapshot(now = Date.now()) {
    this.prune(now);
    return {
      generation: this.generation,
      capacity: this.timelineCapacity,
      retentionMs: this.timelineRetentionMs,
      droppedEvents: this.droppedEvents,
      events: this.timeline.map((event) => ({ ...event })),
    };
  }

  private prune(now: number): void {
    const oldest = now - this.timelineRetentionMs;
    while (this.timeline.length && Date.parse(this.timeline[0]!.at) < oldest) {
      this.timeline.shift();
      this.droppedEvents += 1;
    }
    if (this.timeline.length > this.timelineCapacity) {
      const overflow = this.timeline.length - this.timelineCapacity;
      this.timeline.splice(0, overflow);
      this.droppedEvents += overflow;
    }
  }
}

/** Async cleanup may release its own resources, but cannot clear a newer room. */
export const finishOwnedRoomCleanup = async (
  ownership: RoomSessionOwnership,
  generation: number,
  release: () => Promise<void>,
  clearSharedState: () => void,
): Promise<void> => {
  await release();
  if (ownership.owns(generation)) clearSharedState();
};
