import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ApplicationAudioSource } from "@private-voice/shared";
import type { ApplicationAudioIcon } from "./application-audio-icons";
import {
  ApplicationAudioFrameParser,
  type ApplicationAudioPcm,
} from "./application-audio-protocol";

import {
  readApplicationAudioSources,
  supportsApplicationAudio,
  type NativeApplicationAudioSource,
  type ApplicationAudioSourceOptions,
} from "./application-audio-sources";
export type { NativeApplicationAudioSource } from "./application-audio-sources";
export interface ApplicationAudioSession {
  sessionId: string;
  sampleRate: 48_000;
  channels: 1 | 2;
  format: "s16le";
  gain: number;
}
export interface ApplicationAudioState {
  sessionId: string;
  phase: "starting" | "sharing" | "stopped" | "error";
  code?: string;
  gain: number;
}
interface StartOptions {
  signal?: AbortSignal;
  onPcm?: (frame: ApplicationAudioPcm & { sessionId: string }) => void;
  onState?: (state: ApplicationAudioState) => void;
}
interface ServiceOptions extends ApplicationAudioSourceOptions {
  iconTimeoutMs?: number;
  loadIcons?: (
    sources: readonly NativeApplicationAudioSource[],
  ) => Promise<ReadonlyMap<string, ApplicationAudioIcon>>;
  spawnCapture?: (pid: number, creationTime: string) => ChildProcessWithoutNullStreams;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
}
interface ActiveSession {
  id: string;
  gain: number;
  child: ChildProcessWithoutNullStreams;
  stopped: boolean;
  ready: boolean;
  channels?: 1 | 2;
  options: StartOptions;
  closed: Promise<void>;
  rejectStart: (reason: Error) => void;
  heartbeat?: NodeJS.Timeout;
  startup?: NodeJS.Timeout;
}

/** Owns one explicit application's capture. This never requests system loopback. */
export class ApplicationAudioService {
  private sources = new Map<string, NativeApplicationAudioSource>();
  private active?: ActiveSession;
  private generation = 0;
  private listing = 0;
  private closing = false;
  private iconPending?: Promise<ReadonlyMap<string, ApplicationAudioIcon> | undefined>;

  constructor(private readonly options: ServiceOptions) {}

  async listSources(): Promise<{
    supported: boolean;
    sources: ApplicationAudioSource[];
  }> {
    if (!supportsApplicationAudio(this.options)) return { supported: false, sources: [] };
    if (this.closing) throw new Error("application_audio_closed");
    const listing = ++this.listing;
    const rows = await this.readSources();
    const icons = await this.icons(rows);
    const current = icons?.size ? await this.readSources() : rows;
    if (this.closing || listing !== this.listing) throw new Error("application_audio_superseded");
    this.sources.clear();
    for (const row of rows) this.sources.set(randomUUID(), { ...row });
    return {
      supported: true,
      sources: [...this.sources].map(([id, row]) => ({
        id,
        name: row.name,
        processName: row.processName,
        ...(row.executablePath &&
        current.some(
          (candidate) =>
            candidate.pid === row.pid &&
            candidate.creationTime === row.creationTime &&
            candidate.executablePath === row.executablePath,
        )
          ? icons?.get(row.executablePath)
          : undefined),
      })),
    };
  }

  async start(sourceId: string, options: StartOptions = {}): Promise<ApplicationAudioSession> {
    if (this.closing) throw new Error("application_audio_closed");
    if (!supportsApplicationAudio(this.options)) throw new Error("unsupported_os");
    const selected = this.sources.get(sourceId);
    if (!selected) throw new Error("source_missing");
    const generation = ++this.generation;
    await this.stopActive();
    if (options.signal?.aborted) throw new Error("application_audio_aborted");
    const rows = await this.readSources();
    if (this.closing || generation !== this.generation)
      throw new Error("application_audio_superseded");
    const current = rows.find((row) => row.pid === selected.pid);
    if (!current) throw new Error("source_exited");
    if (
      current.creationTime !== selected.creationTime ||
      current.processName !== selected.processName
    )
      throw new Error("source_identity_changed");
    if (options.signal?.aborted) throw new Error("application_audio_aborted");
    const child =
      this.options.spawnCapture?.(selected.pid, selected.creationTime) ??
      spawn(
        this.options.executablePath,
        ["--application-audio-capture", String(selected.pid), selected.creationTime],
        { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] },
      );
    return this.watch(child, options);
  }

  /** The renderer applies this branch gain; Main validates and publishes its state. */
  setGain(sessionId: string, gain: number): ApplicationAudioState {
    const active = this.active;
    if (!active || active.id !== sessionId || active.stopped || !active.ready)
      throw new Error("application_audio_session_missing");
    if (!Number.isFinite(gain) || gain < 0 || gain > 2) throw new Error("invalid_audio_gain");
    active.gain = gain;
    return this.publish(active, "sharing");
  }

  async stop(sessionId?: string): Promise<void> {
    if (sessionId && this.active?.id !== sessionId) return;
    this.generation++;
    await this.stopActive();
  }

  async close(): Promise<void> {
    this.closing = true;
    this.listing++;
    this.sources.clear();
    await this.stop();
  }

  private async readSources(): Promise<NativeApplicationAudioSource[]> {
    return readApplicationAudioSources(this.options);
  }

  private async icons(rows: readonly NativeApplicationAudioSource[]) {
    if (!this.options.loadIcons) return undefined;
    // One stalled icon lookup must not block selection or multiply on refresh.
    if (!this.iconPending) {
      const pending = this.options
        .loadIcons(rows)
        .catch(() => undefined)
        .finally(() => {
          if (this.iconPending === pending) this.iconPending = undefined;
        });
      this.iconPending = pending;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.iconPending,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), this.options.iconTimeoutMs ?? 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private watch(
    child: ChildProcessWithoutNullStreams,
    options: StartOptions,
  ): Promise<ApplicationAudioSession> {
    let finishClose!: () => void;
    const closed = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    return new Promise((resolve, reject) => {
      const active: ActiveSession = {
        id: randomUUID(),
        gain: 0.72,
        child,
        stopped: false,
        ready: false,
        options,
        closed,
        rejectStart: reject,
      };
      this.active = active;
      const parser = new ApplicationAudioFrameParser();
      let stderr = "";
      const fail = (code: string) => {
        if (active.stopped) return;
        this.finish(active, "error", code);
        child.kill();
      };
      const abort = () => {
        void this.stop(active.id);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", () => fail("capture_spawn_failed"));
      child.stdin.on("error", () => fail("capture_control_closed"));
      child.stdout.on("data", (chunk: Buffer) => {
        if (active.stopped) return;
        try {
          for (const frame of parser.push(chunk)) {
            if (!active.ready || frame.channels !== active.channels)
              throw new Error("unexpected_audio_format");
            options.onPcm?.({ ...frame, sessionId: active.id });
          }
        } catch {
          fail("invalid_audio_frame");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (active.stopped) return;
        stderr += chunk.toString("utf8");
        if (stderr.length > 16_384) {
          fail("invalid_capture_status");
          return;
        }
        let newline: number;
        while ((newline = stderr.indexOf("\n")) >= 0) {
          const line = stderr.slice(0, newline);
          stderr = stderr.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.type === "ready" && !active.ready) {
              if (
                message.sampleRate !== 48_000 ||
                ![1, 2].includes(message.channels) ||
                message.format !== "s16le"
              )
                throw new Error("format");
              active.ready = true;
              active.channels = message.channels;
              clearTimeout(active.startup);
              child.stdin.write("run\n");
              resolve({
                sessionId: active.id,
                sampleRate: 48_000,
                channels: message.channels,
                format: "s16le",
                gain: active.gain,
              });
              this.publish(active, "sharing");
            } else if (message.type === "error") {
              fail(
                typeof message.code === "string" && /^[a-z_]{1,64}$/.test(message.code)
                  ? message.code
                  : "capture_failed",
              );
            } else if (message.type === "stopped") {
              this.finish(
                active,
                "stopped",
                typeof message.code === "string" ? message.code.slice(0, 64) : undefined,
              );
            }
          } catch {
            fail("invalid_capture_status");
          }
        }
      });
      child.once("close", () => {
        options.signal?.removeEventListener("abort", abort);
        if (!active.stopped) this.finish(active, "error", "capture_exited");
        finishClose();
      });
      active.startup = setTimeout(
        () => fail("activation_timeout"),
        this.options.startupTimeoutMs ?? 7_000,
      );
      active.heartbeat = setInterval(() => {
        if (!active.stopped && !child.stdin.destroyed) child.stdin.write("ping\n");
      }, 1_000);
      this.publish(active, "starting");
      if (options.signal?.aborted) abort();
    });
  }

  private publish(
    active: ActiveSession,
    phase: ApplicationAudioState["phase"],
    code?: string,
  ): ApplicationAudioState {
    const state = { sessionId: active.id, phase, gain: active.gain, ...(code ? { code } : {}) };
    try {
      active.options.onState?.(state);
    } catch {
      /* An observer cannot own capture teardown. */
    }
    return state;
  }

  private finish(active: ActiveSession, phase: "stopped" | "error", code?: string): void {
    if (active.stopped) return;
    active.stopped = true;
    clearInterval(active.heartbeat);
    clearTimeout(active.startup);
    if (!active.ready) active.rejectStart(new Error(code ?? "application_audio_stopped"));
    this.publish(active, phase, code);
    if (this.active === active) this.active = undefined;
  }

  private async stopActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.finish(active, "stopped");
    if (!active.child.stdin.destroyed) active.child.stdin.end("stop\n");
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      active.closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          active.child.kill();
          resolve();
        }, this.options.stopTimeoutMs ?? 1_000);
      }),
    ]);
    clearTimeout(timer);
  }
}
