import { request } from "node:https";

import { app, shell } from "electron";
import { autoUpdater } from "electron-updater";
import semver from "semver";

import {
  DEFAULT_RELEASES_URL,
  type RendererLogPayload,
  type UpdateCheckResult,
  type UpdateStatus,
} from "@private-voice/shared";

const RELEASES_API_URL =
  "https://api.github.com/repos/soberbw-hash/shanghao/releases/latest";

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  body?: string;
}

interface UpdatePolicy {
  minSupportedVersion?: string;
  forceUpdate?: boolean;
}

const fetchJson = async <T>(url: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const req = request(
      url,
      {
        headers: {
          "user-agent": "ShangHao/desktop",
          accept: "application/vnd.github+json",
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(6_000, () => req.destroy(new Error("update_check_timeout")));
    req.end();
  });

const parsePolicy = (releaseNotes?: string): UpdatePolicy => {
  const match = releaseNotes?.match(/<!--\s*shanghao-update-policy:\s*(\{.*?\})\s*-->/s);
  if (!match?.[1]) {
    return {};
  }
  try {
    return JSON.parse(match[1]) as UpdatePolicy;
  } catch {
    return {};
  }
};

export class UpdateService {
  private lastResult?: UpdateCheckResult;
  private statusListener?: (status: UpdateStatus) => void;

  constructor(
    private readonly currentVersion: string,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("download-progress", (progress) => {
      this.emit({
        phase: "downloading",
        message: `正在更新 ${Math.round(progress.percent)}%`,
        percent: progress.percent,
        latestVersion: this.lastResult?.latestVersion,
        forceUpdate: this.lastResult?.forceUpdate,
      });
    });
    autoUpdater.on("update-downloaded", () => {
      this.emit({
        phase: "downloaded",
        message: "新版已经准备好，正在安装并重新打开。",
        percent: 100,
        latestVersion: this.lastResult?.latestVersion,
        forceUpdate: this.lastResult?.forceUpdate,
      });
      setTimeout(() => this.install(), 900);
    });
    autoUpdater.on("error", (error) => {
      this.emit({ phase: "error", message: "更新失败，请稍后重试。" });
      void this.log("warn", "automatic update failed", { error: error.message });
    });
  }

  onStatus(listener: (status: UpdateStatus) => void): void {
    this.statusListener = listener;
  }

  async check(): Promise<UpdateCheckResult> {
    this.emit({ phase: "checking", message: "正在检查更新…" });
    try {
      const release = await fetchJson<GitHubReleaseResponse>(RELEASES_API_URL);
      const latestVersion = release.tag_name?.replace(/^v/i, "") || undefined;
      const policy = parsePolicy(release.body);
      const hasUpdate = Boolean(
        latestVersion &&
          semver.valid(latestVersion) &&
          semver.gt(latestVersion, this.currentVersion),
      );
      const belowMinimum = Boolean(
        policy.minSupportedVersion &&
          semver.valid(policy.minSupportedVersion) &&
          semver.lt(this.currentVersion, policy.minSupportedVersion),
      );
      const forceUpdate = hasUpdate && (policy.forceUpdate === true || belowMinimum);

      const result: UpdateCheckResult = {
        currentVersion: this.currentVersion,
        latestVersion,
        hasUpdate,
        forceUpdate,
        minSupportedVersion: policy.minSupportedVersion,
        releaseNotes: release.body,
        canAutoInstall: app.isPackaged,
        checkedAt: new Date().toISOString(),
        releaseUrl: release.html_url || DEFAULT_RELEASES_URL,
        message: hasUpdate
          ? forceUpdate
            ? `需要更新到 ${latestVersion} 后继续使用`
            : `发现新版本 ${latestVersion}`
          : latestVersion
            ? "当前已经是最新版本"
            : "暂时无法判断是否有新版本",
      };
      this.lastResult = result;
      this.emit({
        phase: hasUpdate ? "available" : "idle",
        message: result.message,
        latestVersion,
        forceUpdate,
      });
      await this.log("info", "update check completed", result as unknown as Record<string, unknown>);
      return result;
    } catch (error) {
      const result: UpdateCheckResult = {
        currentVersion: this.currentVersion,
        hasUpdate: false,
        canAutoInstall: app.isPackaged,
        checkedAt: new Date().toISOString(),
        releaseUrl: DEFAULT_RELEASES_URL,
        message: "检查更新失败，请稍后再试。",
      };
      this.emit({ phase: "error", message: result.message });
      await this.log("warn", "update check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return result;
    }
  }

  async download(): Promise<void> {
    if (!app.isPackaged) {
      throw new Error("开发环境不会下载真实更新");
    }
    this.emit({
      phase: "downloading",
      message: "正在准备更新…",
      percent: 0,
      latestVersion: this.lastResult?.latestVersion,
      forceUpdate: this.lastResult?.forceUpdate,
    });
    await autoUpdater.checkForUpdates();
    await autoUpdater.downloadUpdate();
  }

  install(): void {
    if (!app.isPackaged) {
      return;
    }
    this.emit({ phase: "installing", message: "正在安装新版…" });
    autoUpdater.quitAndInstall(false, true);
  }

  async openReleases(): Promise<void> {
    await shell.openExternal(DEFAULT_RELEASES_URL);
  }

  private emit(status: UpdateStatus): void {
    this.statusListener?.(status);
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeLog?.({ category: "updates", level, message, context });
  }
}
