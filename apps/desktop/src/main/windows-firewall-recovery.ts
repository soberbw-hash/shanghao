import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WindowsIntegrationStatus } from "@private-voice/shared";

type Status = WindowsIntegrationStatus["firewall"];

/** Persist before elevation so cancellation, timeout or a crash never prompts again on restart. */
export const firewallRepairAttempt = (directory: string, executable: string) => {
  const key = createHash("sha256").update(executable.toLowerCase()).digest("hex");
  const target = path.join(directory, `${key}.attempt`);
  return {
    claim: async () => {
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(target, "ShangHao.FirewallRepair.v1", { flag: "wx" });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    },
    clear: async () => {
      await unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
};

/** Owns one repair across startup, periodic checks and explicit retries. Never resets a room. */
export class WindowsFirewallRecovery {
  private status?: Status;
  private checking?: Promise<Status>;
  private repairing?: Promise<Status>;
  private checkedAt = 0;

  constructor(
    private readonly dependencies: {
      read: () => Promise<Status>;
      repair: () => Promise<Status>;
      claim: () => Promise<boolean>;
      clear: () => Promise<void>;
      enabled: () => boolean;
      now?: () => number;
    },
  ) {}

  inspect(force = false): Promise<Status> {
    if (this.repairing && this.status) return Promise.resolve(this.status);
    if (this.checking) return this.checking;
    const now = this.dependencies.now?.() ?? Date.now();
    if (!force && this.status && now - this.checkedAt < 30_000) return Promise.resolve(this.status);
    this.checking = this.check().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async check(): Promise<Status> {
    try {
      const previous = this.status?.repairState;
      const current = await this.dependencies.read();
      this.checkedAt = this.dependencies.now?.() ?? Date.now();
      this.status = { ...current, repairState: "idle" };
      if (!current.supported || !this.dependencies.enabled()) return this.status;
      if (current.healthy) {
        await this.dependencies.clear().catch(() => undefined);
        return this.status;
      }
      if (await this.dependencies.claim()) {
        void this.startRepair();
      } else {
        this.status.repairState = previous === "authorization_required" ? previous : "failed";
        this.status.message =
          previous === "authorization_required"
            ? "Windows 授权已取消，网络权限尚未修复。"
            : "自动修复未完成；重试时可能需要 Windows 授权。";
      }
    } catch {
      this.status = {
        supported: true,
        healthy: false,
        ruleCount: 0,
        expectedRuleCount: 4,
        repairState: "unavailable",
        message: "暂时无法检查网络权限，稍后会自动重新检查。",
      };
      this.checkedAt = this.dependencies.now?.() ?? Date.now();
    }
    return this.status;
  }

  async retry(): Promise<Status> {
    if (this.checking) await this.checking;
    if (this.repairing) return this.repairing;
    if (this.status?.healthy) return this.status;
    return this.startRepair(true);
  }

  private startRepair(remember = false): Promise<Status> {
    if (this.repairing) return this.repairing;
    this.status = {
      ...(this.status ?? { supported: true, healthy: false, ruleCount: 0, expectedRuleCount: 4 }),
      repairState: "repairing",
      message: "正在自动修复网络权限，请完成 Windows 授权。",
    };
    this.repairing = this.runRepair(remember).finally(() => {
      this.repairing = undefined;
    });
    return this.repairing;
  }

  private async runRepair(remember: boolean): Promise<Status> {
    try {
      if (remember) await this.dependencies.claim().catch(() => false);
      const verified = await this.dependencies.repair(); // Repair includes a read-only verification.
      this.status = { ...verified, repairState: verified.healthy ? "idle" : "failed" };
      if (verified.healthy) await this.dependencies.clear().catch(() => undefined);
    } catch (error) {
      const cancelled = error instanceof Error && error.message === "windows_uac_cancelled";
      this.status = {
        ...this.status!,
        repairState: cancelled ? "authorization_required" : "failed",
        message: cancelled
          ? "Windows 授权已取消，网络权限尚未修复。"
          : "自动修复未完成，可以重新尝试或导出诊断报告。",
      };
    }
    this.checkedAt = this.dependencies.now?.() ?? Date.now();
    return this.status!;
  }
}
