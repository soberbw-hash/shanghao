import {
  visualRuntimeController,
  type VisualFrameContext,
  type VisualRuntimeController,
} from "./VisualRuntimeController";

export interface RoomVisualMutation<T = unknown> {
  key: string;
  read?: () => T;
  write: (value: T | undefined, frame: VisualFrameContext) => void;
}

export class RoomAnimationScheduler {
  private readonly pending = new Map<string, RoomVisualMutation>();
  private stopFrameTask?: () => void;
  private reconcileRequired = false;
  private droppedEvents = 0;

  constructor(
    private readonly runtime: VisualRuntimeController = visualRuntimeController,
    private readonly maxPending = 128,
    private readonly fullReconcile?: (frame: VisualFrameContext) => void,
  ) {}

  enqueue<T>(mutation: RoomVisualMutation<T>): void {
    if (!this.pending.has(mutation.key) && this.pending.size >= this.maxPending) {
      const oldestKey = this.pending.keys().next().value as string | undefined;
      if (oldestKey) this.pending.delete(oldestKey);
      this.droppedEvents += 1;
      this.reconcileRequired = true;
    }
    this.pending.set(mutation.key, mutation as RoomVisualMutation);
    if (!this.stopFrameTask) {
      this.stopFrameTask = this.runtime.registerTask("room-animation-scheduler", this.flush);
    }
  }

  clear(): void {
    this.pending.clear();
    this.reconcileRequired = false;
    this.stopFrameTask?.();
    this.stopFrameTask = undefined;
  }

  snapshot(): { pending: number; droppedEvents: number; reconcileRequired: boolean } {
    return {
      pending: this.pending.size,
      droppedEvents: this.droppedEvents,
      reconcileRequired: this.reconcileRequired,
    };
  }

  private readonly flush = (frame: VisualFrameContext): boolean => {
    const mutations = [...this.pending.values()];
    this.pending.clear();
    const values = mutations.map((mutation) => mutation.read?.());

    if (this.reconcileRequired) {
      this.reconcileRequired = false;
      this.fullReconcile?.(frame);
    } else {
      mutations.forEach((mutation, index) => mutation.write(values[index], frame));
    }

    this.stopFrameTask = undefined;
    return false;
  };
}

export const roomAnimationScheduler = new RoomAnimationScheduler();
