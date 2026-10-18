import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { app } from "electron";
import { platformService } from "./platform/PlatformService";
import type { PhoneShortcut, PhonePhysicalInput } from "./phone-shortcut";

/** Independent native sampling survives a silently removed low-level hook. */
export class PhoneInputMonitor {
  private child?: ChildProcessWithoutNullStreams;
  private timer?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private generation = 0;
  private binding?: PhoneShortcut;
  private lastMessage = 0;
  private failures = 0;
  constructor(
    private readonly availability: (ready: boolean, rawInput?: boolean) => void,
    private readonly acceptSample: (sampledAt: number) => boolean = () => true,
  ) {}

  configure(binding?: PhoneShortcut): void {
    this.stop();
    this.binding = binding;
    if (platformService.isWindows && binding?.virtualKey !== undefined) this.start();
  }
  private start(): void {
    const binding = this.binding;
    if (!binding || binding.virtualKey === undefined) return;
    const generation = this.generation;
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, "native", "ShangHao.PhoneInput.exe")
      : path.join(app.getAppPath(), "resources/native/ShangHao.PhoneInput.exe");
    const child = spawn(executable, [], { windowsHide: true, stdio: "pipe" });
    this.child = child;
    this.lastMessage = Date.now();
    child.stdin.on("error", () => retire());
    child.stdout.on("error", () => retire());
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    let ready = false;
    let retired = false;
    const retire = () => {
      if (retired) return;
      retired = true;
      lines.close();
      child.stdin.end();
      child.kill();
      if (generation !== this.generation) return;
      this.availability(false); // Retain press ownership; falling back must not unmute.
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.child = undefined;
      this.retry = setTimeout(
        () => this.start(),
        Math.min(30_000, 500 * 2 ** Math.min(this.failures++, 6)),
      );
    };
    lines.on("line", (line) => {
      if (generation !== this.generation || retired || line.length > 1024) return;
      try {
        const value = JSON.parse(line) as Partial<PhonePhysicalInput> & {
          ready?: boolean;
          rawInput?: boolean;
          sampledAt?: number;
        };
        if (value.ready === true) {
          ready = true;
          this.failures = 0;
          this.lastMessage = Date.now();
          this.availability(true, value.rawInput === true);
        } else if (
          ready &&
          [value.down, value.ctrlKey, value.altKey, value.shiftKey, value.metaKey].every(
            (field) => typeof field === "boolean",
          )
        ) {
          this.lastMessage = Date.now();
          if (
            typeof value.sampledAt === "number" &&
            Number.isFinite(value.sampledAt) &&
            Math.abs(Date.now() - value.sampledAt) < 5000 &&
            this.acceptSample(value.sampledAt)
          )
            binding.synchronizePhysical(value as PhonePhysicalInput);
        }
      } catch {
        /* Malformed data cannot trigger a phone transition. */
      }
    });
    child.once("error", retire);
    child.once("exit", retire);
    child.stdin.write(JSON.stringify({ virtualKey: binding.virtualKey }) + "\n");
    this.timer = setInterval(() => {
      if (Date.now() - this.lastMessage > 3500) retire();
    }, 1000);
  }
  stop(): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    this.timer = this.retry = undefined;
    this.binding = undefined;
    this.availability(false);
    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
      this.child = undefined;
    }
  }
}
