import type { MemberAvailability } from "./memberAvailability";

export type AvailabilityChoice = MemberAvailability | "phone";
type Snapshot = { isMuted: boolean; isDeafened: boolean; isManuallyMuted: boolean };
type Audio = Snapshot & {
  phoneModeActive: boolean;
  setAudioState(state: Snapshot): void;
  setPhoneModeResumeState(state: Snapshot): void;
};
interface Dependencies {
  audio(): Audio;
  status(): MemberAvailability | undefined;
  ownsRoom(): boolean;
  phone(active: boolean): Promise<void>;
  select(status?: MemberAvailability): void;
  hold(): () => void;
  reconcile(): void;
  failed(): void;
}
const snapshot = (audio: Audio): Snapshot => ({
  isMuted: audio.isMuted,
  isDeafened: audio.isDeafened,
  isManuallyMuted: audio.isManuallyMuted,
});

/** One mutually exclusive mouse choice. Native transitions serialize; network ACKs never block selection. */
export class MemberAvailabilityController {
  private baseline?: Snapshot;
  private running = false;
  private closed = false;
  private intent?: AvailabilityChoice;
  private pending?: { choice?: AvailabilityChoice };
  private release?: () => void;
  constructor(private readonly deps: Dependencies) {}

  choose(choice: AvailabilityChoice): void {
    if (this.closed || !this.deps.ownsRoom()) return;
    if (!this.running && !this.deps.audio().phoneModeActive && !this.deps.status())
      this.baseline = undefined;
    const current = this.running
      ? this.intent
      : this.deps.audio().phoneModeActive
        ? "phone"
        : this.deps.status();
    this.intent = current === choice ? undefined : choice;
    this.pending = { choice: this.intent };
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    const unlock = this.deps.hold();
    let released = false;
    const release = (this.release = () => {
      if (!released) {
        released = true;
        unlock();
      }
    });
    try {
      while (this.pending && !this.closed && this.deps.ownsRoom()) {
        const { choice } = this.pending;
        this.pending = undefined;
        try {
          const before = this.deps.audio();
          if (!this.baseline && !before.phoneModeActive) this.baseline = snapshot(before);
          if (choice === "phone") {
            if (!before.phoneModeActive) await this.deps.phone(true);
            if (this.closed || !this.deps.ownsRoom()) return;
            if (!this.deps.audio().phoneModeActive) throw Error("phone_entry_unconfirmed");
            // Keyboard cancellation of a mouse-selected phone status must also restore the original baseline.
            if (this.baseline) this.deps.audio().setPhoneModeResumeState(this.baseline);
            if (!this.pending) this.deps.select(undefined);
          } else {
            if (before.phoneModeActive) await this.deps.phone(false);
            if (this.closed || !this.deps.ownsRoom()) return;
            if (this.deps.audio().phoneModeActive) throw Error("phone_exit_unconfirmed");
            if (this.pending) continue; // Do not briefly restore the mic for an obsolete click.
            const original = this.baseline ?? snapshot(this.deps.audio());
            this.deps.audio().setAudioState(
              choice
                ? {
                    isMuted: true,
                    isDeafened: choice === "away" || original.isDeafened,
                    isManuallyMuted: false,
                  }
                : original,
            );
            this.baseline = choice ? original : undefined;
            this.deps.select(choice);
          }
        } catch {
          if (this.closed || !this.deps.ownsRoom()) return;
          const audio = this.deps.audio();
          audio.setAudioState({
            isMuted: true,
            isDeafened: audio.isDeafened,
            isManuallyMuted: false,
          });
          this.deps.failed();
        }
      }
    } finally {
      release();
      if (this.release === release) this.release = undefined;
      this.running = false;
      if (!this.closed && this.deps.ownsRoom()) this.deps.reconcile();
    }
  }

  dispose(): void {
    this.closed = true;
    this.pending = undefined;
    this.baseline = undefined;
    this.release?.();
  }
}
