import type { ChatMixSession, ChatMixSessionId } from "./chat-mix-volume-leases";

const SPEECH_ONSET_THRESHOLD_MS = 220;
const SPEECH_HANGOVER_MS = 850;
const ATTACK_TIME_CONSTANT_MS = 300;
const RELEASE_TIME_CONSTANT_MS = 500;
const FACTOR_SETTLED_EPSILON = 0.001;

export interface ChatMixActivity {
  enabled: boolean;
  inRoom: boolean;
  speaking: boolean;
}
export interface ChatMixControllerPorts {
  list(): Promise<ChatMixSession[]>;
  attenuate(
    session: ChatMixSessionId,
    factor: number,
    excluded: ReadonlySet<number>,
  ): Promise<boolean>;
  restore(): Promise<{ pending: number }>;
  ownProcesses(): ReadonlySet<number>;
}
export type ChatMixPhase = "off" | "ready" | "waiting" | "balancing" | "recovering";

/** Main owns the clock. Renderer activity expires; polling never queues overlapping COM work. */
export class ChatMixController {
  private activity: ChatMixActivity = { enabled: false, inRoom: false, speaking: false };
  private activityUntil = 0;
  private speechUntil = 0;
  private speechStartedAt?: number;
  private factor = 1;
  private recovery = true;
  private recoveredOnce = false;
  private touched = false;
  private disposed = false;
  private flight?: Promise<void>;
  private retryAt = 0;
  private retryDelay = 1000;
  private lastTick?: number;
  private lastDiscovery = -Infinity;
  private targets: ChatMixSession[] = [];
  private adjusted = new Set<string>();
  private phase: ChatMixPhase = "off";
  constructor(
    private readonly ports: ChatMixControllerPorts,
    private readonly clock = () => performance.now(),
  ) {}

  update(activity: ChatMixActivity): void {
    if (this.disposed) return;
    const now = this.clock();
    this.activity = { ...activity };
    this.activityUntil = now + 2500;
    if (activity.enabled && activity.inRoom && activity.speaking) {
      this.speechStartedAt ??= now;
      if (now - this.speechStartedAt >= SPEECH_ONSET_THRESHOLD_MS)
        this.speechUntil = now + SPEECH_HANGOVER_MS;
    } else {
      this.speechStartedAt = undefined;
      if (!activity.enabled || !activity.inRoom) this.speechUntil = 0;
    }
  }
  getPhase(): ChatMixPhase {
    return this.phase;
  }
  tick(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.flight) return this.flight;
    const work = this.run().finally(() => {
      if (this.flight === work) this.flight = undefined;
    });
    this.flight = work;
    return work;
  }
  private async run(): Promise<void> {
    const now = this.clock();
    if (now < this.retryAt) return;
    try {
      if (this.recovery) {
        this.phase = "recovering";
        const result = await this.ports.restore();
        if (result.pending) {
          this.retryAt = now + 1500;
          return;
        }
        this.recovery = false;
        this.touched = false;
        this.factor = 1;
        this.retryDelay = 1000;
        this.lastDiscovery = -Infinity;
        // Startup must retain the first speech edge; a fault must settle old writes first.
        if (this.recoveredOnce) this.speechUntil = 0;
        this.recoveredOnce = true;
        this.adjusted.clear();
      }
      if (this.disposed) return;
      const enabled = this.activity.enabled && this.activity.inRoom && now < this.activityUntil;
      const target = enabled && now < this.speechUntil ? 0.35 : 1;
      // Cap a delayed tick, rather than jumping straight to the target after a busy frame.
      const elapsed = Math.min(120, Math.max(0, now - (this.lastTick ?? now - 100)));
      this.lastTick = now;
      const previousFactor = this.factor;
      const timeConstant =
        target < this.factor ? ATTACK_TIME_CONSTANT_MS : RELEASE_TIME_CONSTANT_MS;
      const smoothing = 1 - Math.exp(-elapsed / timeConstant);
      this.factor += (target - this.factor) * smoothing;
      if (Math.abs(target - this.factor) <= FACTOR_SETTLED_EPSILON) this.factor = target;
      if (this.factor === 1) {
        if (this.touched) {
          const result = await this.ports.restore();
          if (result.pending) {
            this.recovery = true;
            this.phase = "recovering";
            this.retryAt = now + 1500;
            return;
          }
          this.touched = false;
          this.adjusted.clear();
        }
        this.phase = enabled ? "ready" : "off";
        return;
      }
      if (this.factor === previousFactor && now - this.lastDiscovery < 1000) return;
      const excluded = this.ports.ownProcesses();
      // An unavailable process inventory must never mean that every application is a target.
      if (!excluded.size || [...excluded].some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
        throw Error("chat_mix_process_inventory_unavailable");
      if (now - this.lastDiscovery >= 1000) {
        const sessions = await this.ports.list();
        this.targets = sessions
          .filter((session) => !excluded.has(session.processId) && !session.muted)
          .slice(0, 32);
        this.lastDiscovery = now;
      }
      this.adjusted.clear();
      for (const session of this.targets) {
        // stop()/disable/renderer loss may occur during an awaited native call.
        if (
          this.disposed ||
          !this.activity.enabled ||
          !this.activity.inRoom ||
          this.clock() >= this.activityUntil
        )
          break;
        this.touched = true; // A lost reply may have already changed the volume.
        if (await this.ports.attenuate(session, this.factor, excluded))
          this.adjusted.add(
            JSON.stringify([session.deviceId, session.instanceId, session.processId]),
          );
      }
      this.phase = this.adjusted.size ? "balancing" : "waiting";
    } catch {
      this.recovery = true;
      this.phase = "recovering";
      this.factor = 1;
      this.retryAt = this.clock() + this.retryDelay;
      this.retryDelay = Math.min(15_000, this.retryDelay * 2);
    }
  }
  async stop(): Promise<{ pending: number }> {
    this.disposed = true;
    await this.flight;
    this.phase = "off";
    return this.ports.restore();
  }
}
