import type { AppSettings } from "@private-voice/shared";

const modelSettingKeys = [
  "aiAsrModel",
  "aiTranscriptionProvider",
  "isAiCloudLocalAssistEnabled",
  "aiCloudLocalAsrModel",
  "aiTextModelPreset",
  "aiOrganizerProvider",
  "aiRoomAskProvider",
] as const;

/** Counts whole AI operations, including cloud work and cancellation cleanup. */
export class AiModelConfigurationUsage {
  private active = 0;
  private changeFinished?: Promise<void>;
  private readonly listeners = new Set<() => void>();

  get busy(): boolean {
    return this.active > 0 || Boolean(this.changeFinished);
  }

  assertIdle(): void {
    if (this.busy) throw new Error("ai_model_configuration_in_use");
  }

  changeSettings<T>(patch: Partial<AppSettings>, operation: () => Promise<T>): Promise<T> {
    return modelSettingKeys.some((key) => Object.hasOwn(patch, key))
      ? this.change(operation)
      : operation();
  }

  async change<T>(operation: () => Promise<T>): Promise<T> {
    this.assertIdle();
    let release!: () => void;
    this.changeFinished = new Promise<void>((resolve) => (release = resolve));
    this.emit();
    try {
      return await operation();
    } finally {
      this.changeFinished = undefined;
      release();
      if (!this.busy) this.emit();
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const pendingChange = this.changeFinished;
    if (++this.active === 1 && !pendingChange) this.emit();
    try {
      if (pendingChange) await pendingChange;
      return await operation();
    } finally {
      if (--this.active === 0) this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const aiModelConfigurationUsage = new AiModelConfigurationUsage();
