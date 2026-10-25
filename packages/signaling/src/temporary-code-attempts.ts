export interface TemporaryCodeAttemptOptions {
  deviceFailures?: number;
  networkFailures?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retentionMs?: number;
  maxEntries?: number;
}
interface AttemptState {
  failures: number;
  blockedUntil: number;
  expiresAt: number;
}
/** Server-only knobs; renderer and room requests cannot change these limits. */
export function temporaryCodeAttemptOptionsFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): TemporaryCodeAttemptOptions {
  const result: TemporaryCodeAttemptOptions = {};
  const names = {
    deviceFailures: "DEVICE_FAILURES",
    networkFailures: "NETWORK_FAILURES",
    baseDelayMs: "BASE_DELAY_MS",
    maxDelayMs: "MAX_DELAY_MS",
    retentionMs: "RETENTION_MS",
    maxEntries: "MAX_ENTRIES",
  } as const;
  for (const [key, suffix] of Object.entries(names)) {
    const value = env[`SHANGHAO_TEMP_CODE_${suffix}`];
    if (value === undefined) continue;
    if (!/^[0-9]{1,9}$/.test(value)) throw Error("temporary_code_configuration_invalid");
    result[key as keyof TemporaryCodeAttemptOptions] = Number(value);
  }
  return result;
}
const option = (value: number | undefined, fallback: number, maximum: number) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw Error("temporary_code_configuration_invalid");
  return value;
};

/** Authenticated devices and trusted network sources share bounded, in-memory guessing history. */
export class TemporaryCodeAttempts {
  private readonly entries = new Map<string, AttemptState>();
  private readonly deviceFailures: number;
  private readonly networkFailures: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retentionMs: number;
  private readonly maxEntries: number;
  private lastNow = -Infinity;
  constructor(
    private readonly clock = Date.now,
    options: TemporaryCodeAttemptOptions = temporaryCodeAttemptOptionsFromEnvironment(),
  ) {
    this.deviceFailures = option(options.deviceFailures, 5, 1000);
    this.networkFailures = option(options.networkFailures, 20, 10000);
    this.baseDelayMs = option(options.baseDelayMs, 2000, 60000);
    this.maxDelayMs = option(options.maxDelayMs, 300000, 3600000);
    this.retentionMs = option(options.retentionMs, 1800000, 86400000);
    this.maxEntries = option(options.maxEntries, 8192, 100000);
    if (
      this.maxEntries < 2 ||
      this.maxDelayMs < this.baseDelayMs ||
      this.retentionMs < this.maxDelayMs
    )
      throw Error("temporary_code_configuration_invalid");
  }
  private now() {
    const raw = this.clock();
    if (!Number.isFinite(raw)) throw Error("temporary_rate_limited");
    return (this.lastNow = Math.max(this.lastNow, raw));
  }
  sweep(): void {
    const now = this.now();
    for (const [key, value] of this.entries) if (now >= value.expiresAt) this.entries.delete(key);
  }
  attempt<T>(
    deviceId: string,
    address: string,
    operation: () => T,
    matched: (value: T) => boolean | undefined = () => true,
  ): T {
    this.sweep();
    const now = this.now();
    const keys = [`device:${deviceId}`, `network:${address}`];
    // Check existing limits before allocating for a new identity on a blocked network.
    if (keys.some((key) => (this.entries.get(key)?.blockedUntil ?? 0) > now))
      throw Error("temporary_rate_limited");
    if (this.entries.size + keys.filter((key) => !this.entries.has(key)).length > this.maxEntries)
      throw Error("temporary_rate_limited");
    for (const key of keys)
      if (!this.entries.has(key))
        this.entries.set(key, { failures: 0, blockedUntil: 0, expiresAt: now + this.retentionMs });
    const fail = () => {
      keys.forEach((key, index) => {
        const entry = this.entries.get(key)!;
        entry.failures = Math.min(10001, entry.failures + 1);
        entry.expiresAt = now + this.retentionMs;
        const excess = entry.failures - (index === 0 ? this.deviceFailures : this.networkFailures);
        if (excess >= 0)
          entry.blockedUntil =
            now + Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(excess, 20));
      });
    };
    const releaseUnused = () => {
      for (const key of keys) if (!this.entries.get(key)?.failures) this.entries.delete(key);
    };
    try {
      const value = operation();
      const match = matched(value);
      if (match === true) {
        this.entries.delete(keys[0]!);
        releaseUnused();
      } else if (match === false) fail();
      else releaseUnused();
      return value;
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "temporary_room_not_found",
          "temporary_room_code_invalid",
          "temporary_request_invalid",
        ].includes(error.message)
      )
        fail();
      else releaseUnused();
      throw error;
    }
  }
}
