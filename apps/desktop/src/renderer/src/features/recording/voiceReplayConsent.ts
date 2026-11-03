/** Consent applies only to the exact current room and membership epoch. */
export class VoiceReplayConsent {
  private members = new Set<string>();
  private approvals = new Set<string>();
  private epoch = 0;
  private enabled = false;

  constructor(private readonly clearHistory: () => void) {}

  updateMembers(memberIds: readonly string[]): number {
    const next = new Set(memberIds);
    if (next.size === this.members.size && [...next].every((id) => this.members.has(id)))
      return this.epoch;
    this.clearHistory();
    this.enabled = false;
    this.members = next;
    this.approvals.clear();
    return ++this.epoch;
  }

  approve(memberId: string, epoch: number): boolean {
    if (epoch !== this.epoch || !this.members.has(memberId)) return false;
    this.approvals.add(memberId);
    this.enabled = this.members.size > 0 && this.approvals.size === this.members.size;
    return this.enabled;
  }

  revoke(memberId: string, epoch: number): void {
    if (epoch !== this.epoch || !this.members.has(memberId)) return;
    this.approvals.delete(memberId);
    this.enabled = false;
    this.clearHistory();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  close(): void {
    this.clearHistory();
    this.enabled = false;
    this.members.clear();
    this.approvals.clear();
    this.epoch++;
  }
}
