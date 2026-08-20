import type { FlightRecorderEvent, FlightRecorderSnapshot, LogEntry } from "@private-voice/shared";

const DEFAULT_RETENTION_MS = 10 * 60 * 1_000;
const DEFAULT_CAPACITY = 1_200;

const allowedMetric = (value: unknown): value is string | number | boolean | null =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

const sanitizeMetrics = (
  context: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined => {
  if (!context) return undefined;
  const entries = Object.entries(context)
    .filter(([key, value]) => {
      if (!allowedMetric(value)) return false;
      return !/(path|file|recording|transcript|message|nickname|email|sid|token|url)/i.test(key);
    })
    .slice(0, 24);
  if (!entries.length) return undefined;
  return entries.reduce<Record<string, string | number | boolean | null>>(
    (metrics, [key, value]) => {
      if (allowedMetric(value)) metrics[key] = value;
      return metrics;
    },
    {},
  );
};

const sourceForCategory = (category: LogEntry["category"]): FlightRecorderEvent["source"] => {
  if (category === "audio" || category === "devices") return "audio";
  if (category === "webrtc" || category === "signaling" || category === "relay") {
    return "realtime";
  }
  if (category === "updates") return "update";
  return "main";
};

export class FlightRecorder {
  private readonly events: FlightRecorderEvent[] = [];
  private nextId = 1;
  private droppedEvents = 0;

  constructor(
    private readonly retentionMs = DEFAULT_RETENTION_MS,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {}

  record(event: Omit<FlightRecorderEvent, "id" | "timestamp"> & { timestamp?: string }): void {
    const timestamp = event.timestamp ?? new Date().toISOString();
    this.events.push({ ...event, id: this.nextId++, timestamp });
    this.prune(Date.parse(timestamp));
  }

  recordLog(entry: LogEntry): void {
    this.record({
      timestamp: entry.timestamp,
      source: sourceForCategory(entry.category),
      level: entry.level,
      event: entry.message.slice(0, 160),
      metrics: sanitizeMetrics(entry.context),
    });
  }

  snapshot(now = Date.now()): FlightRecorderSnapshot {
    this.prune(now);
    return {
      capturedAt: new Date(now).toISOString(),
      retentionMs: this.retentionMs,
      capacity: this.capacity,
      droppedEvents: this.droppedEvents,
      events: this.events.map((event) => ({
        ...event,
        metrics: event.metrics && { ...event.metrics },
      })),
    };
  }

  private prune(now: number): void {
    const oldestAllowed = now - this.retentionMs;
    while (this.events.length && Date.parse(this.events[0]?.timestamp ?? "") < oldestAllowed) {
      this.events.shift();
    }
    if (this.events.length <= this.capacity) return;
    const overflow = this.events.length - this.capacity;
    this.events.splice(0, overflow);
    this.droppedEvents += overflow;
  }
}
