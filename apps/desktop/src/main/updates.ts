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

const RELEASES_API_URL = "https://api.github.com/repos/soberbw-hash/shanghao/releases/latest";
const MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024;
const RELEASE_CACHE_MAX_AGE_MS = 6 * 60 * 60_000;

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  body?: string;
}

interface UpdatePolicy {
  minSupportedVersion?: string;
  forceUpdate?: boolean;
}

type UpdaterWithQuitEvent = typeof autoUpdater & {
  on(event: "before-quit-for-update", listener: () => void): void;
};

class UpdateCheckHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
  }
}

interface ReleaseHttpResult {
  status: number;
  etag?: string;
  release?: GitHubReleaseResponse;
}

const fetchLatestRelease = async (etag?: string): Promise<ReleaseHttpResult> =>
  new Promise<ReleaseHttpResult>((resolve, reject) => {
    const req = request(
      RELEASES_API_URL,
      {
        headers: {
          "user-agent": "ShangHao/desktop",
          accept: "application/vnd.github+json",
          ...(etag ? { "if-none-match": etag } : {}),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const responseEtag = response.headers.etag;
        if (status === 304) {
          response.resume();
          resolve({ status, etag: responseEtag });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          const code =
            status === 403 && response.headers["x-ratelimit-remaining"] === "0"
              ? "update_rate_limited"
              : status === 404
                ? "update_release_not_found"
                : status >= 500
                  ? "update_server_error"
                  : `update_http_${status}`;
          reject(new UpdateCheckHttpError(code, status));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_RELEASE_RESPONSE_BYTES) {
            req.destroy(new UpdateCheckHttpError("update_response_too_large", status));
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          try {
            const release = JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as GitHubReleaseResponse;
            if (!release || typeof release !== "object") throw new Error("invalid_release_json");
            resolve({ status, etag: responseEtag, release });
          } catch {
            reject(new UpdateCheckHttpError("update_invalid_json", status));
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(6_000, () => req.destroy(new UpdateCheckHttpError("update_check_timeout")));
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
  private cachedRelease?: { release: GitHubReleaseResponse; etag?: string; checkedAt: number };
  private statusListener?: (status: UpdateStatus) => void;
  private installStarted = false;
  private downloadStarted = false;
  private downloadReady = false;
  private pendingBackgroundDownload = false;
  private backgroundDownloadRetryTimer?: NodeJS.Timeout;
  private deferBackgroundDownload?: () => boolean;
  private installHandoffPromise?: Promise<void>;

  constructor(
    private readonly currentVersion: string,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    private readonly beforeInstall?: () => void | Promise<void>,
  ) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("download-progress", (progress) => {
      const speedMb = Math.max(0, progress.bytesPerSecond / 1024 ** 2);
      this.emit({
        phase: "downloading",
        message: `正在下载 ${Math.round(progress.percent)}% · ${speedMb.toFixed(1)} MB/s`,
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        latestVersion: this.lastResult?.latestVersion,
        forceUpdate: this.lastResult?.forceUpdate,
      });
    });
    autoUpdater.on("update-downloaded", () => {
      this.downloadReady = true;
      this.emit({
        phase: "ready_to_restart",
        message: "新版已下载，等你确认后安装。",
        percent: 100,
        latestVersion: this.lastResult?.latestVersion,
        forceUpdate: this.lastResult?.forceUpdate,
      });
    });
    (autoUpdater as UpdaterWithQuitEvent).on("before-quit-for-update", () => {
      void this.prepareInstallHandoff();
      void this.log("info", "automatic update requested app quit");
    });
    autoUpdater.on("error", (error) => {
      this.downloadStarted = false;
      this.emit({ phase: "error", message: "更新失败，请稍后重试。" });
      void this.log("warn", "automatic update failed", { error: error.message });
    });
  }

  onStatus(listener: (status: UpdateStatus) => void): void {
    this.statusListener = listener;
  }

  setBackgroundDownloadGuard(guard: () => boolean): void {
    this.deferBackgroundDownload = guard;
  }

  async check(): Promise<UpdateCheckResult> {
    this.emit({ phase: "checking", message: "正在检查更新…" });
    try {
      const response = await fetchLatestRelease(this.cachedRelease?.etag);
      const release = response.release ?? this.cachedRelease?.release;
      if (!release) throw new UpdateCheckHttpError("update_cache_missing", response.status);
      this.cachedRelease = {
        release,
        etag: response.etag ?? this.cachedRelease?.etag,
        checkedAt: Date.now(),
      };
      const result = this.resultFromRelease(release);
      this.lastResult = result;
      this.emit({
        phase: result.hasUpdate ? "available" : "idle",
        message: result.message,
        latestVersion: result.latestVersion,
        forceUpdate: result.forceUpdate,
      });
      if (result.hasUpdate && app.isPackaged) {
        void this.download(false).catch(() => undefined);
      }
      await this.log("info", "update check completed", {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        hasUpdate: result.hasUpdate,
        forceUpdate: result.forceUpdate,
        checkedAt: result.checkedAt,
        httpStatus: response.status,
      });
      return result;
    } catch (error) {
      const cached = this.cachedRelease;
      if (cached && Date.now() - cached.checkedAt < RELEASE_CACHE_MAX_AGE_MS) {
        const result = this.resultFromRelease(cached.release, true);
        this.lastResult = result;
        this.emit({
          phase: result.hasUpdate ? "available" : "idle",
          message: result.message,
          latestVersion: result.latestVersion,
          forceUpdate: result.forceUpdate,
        });
        await this.log("warn", "update check used recent cache", {
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          hasUpdate: result.hasUpdate,
          checkedAt: result.checkedAt,
          errorCode: error instanceof UpdateCheckHttpError ? error.code : "update_network_error",
          httpStatus: error instanceof UpdateCheckHttpError ? error.status : undefined,
        });
        return result;
      }
      const result: UpdateCheckResult = {
        currentVersion: this.currentVersion,
        hasUpdate: false,
        canAutoInstall: app.isPackaged,
        checkedAt: new Date().toISOString(),
        releaseUrl: DEFAULT_RELEASES_URL,
        message:
          error instanceof UpdateCheckHttpError && error.code === "update_rate_limited"
            ? "更新服务请求过于频繁，请稍后再试。"
            : "检查更新失败，请稍后再试。",
      };
      this.emit({ phase: "error", message: result.message });
      await this.log("warn", "update check failed", {
        errorCode: error instanceof UpdateCheckHttpError ? error.code : "update_network_error",
        httpStatus: error instanceof UpdateCheckHttpError ? error.status : undefined,
      });
      return result;
    }
  }

  private resultFromRelease(release: GitHubReleaseResponse, fromCache = false): UpdateCheckResult {
    const latestVersion = release.tag_name?.replace(/^v/i, "") || undefined;
    const policy = parsePolicy(release.body);
    const hasUpdate = Boolean(
      latestVersion && semver.valid(latestVersion) && semver.gt(latestVersion, this.currentVersion),
    );
    const belowMinimum = Boolean(
      policy.minSupportedVersion &&
      semver.valid(policy.minSupportedVersion) &&
      semver.lt(this.currentVersion, policy.minSupportedVersion),
    );
    const forceUpdate = hasUpdate && (policy.forceUpdate === true || belowMinimum);
    const message = hasUpdate
      ? forceUpdate
        ? `需要更新到 ${latestVersion} 后继续使用`
        : `发现新版本 ${latestVersion}`
      : latestVersion
        ? "当前已经是最新版本"
        : "暂时无法判断是否有新版本";
    return {
      currentVersion: this.currentVersion,
      latestVersion,
      hasUpdate,
      forceUpdate,
      minSupportedVersion: policy.minSupportedVersion,
      releaseNotes: release.body,
      canAutoInstall: app.isPackaged,
      checkedAt: new Date().toISOString(),
      releaseUrl: release.html_url || DEFAULT_RELEASES_URL,
      message: fromCache ? `${message}（上次检查结果）` : message,
    };
  }

  async download(manual = true): Promise<void> {
    if (!app.isPackaged) {
      throw new Error("开发环境不会下载真实更新");
    }
    if (this.downloadReady || this.downloadStarted) return;
    if (!manual && this.deferBackgroundDownload?.()) {
      this.pendingBackgroundDownload = true;
      this.scheduleBackgroundDownloadRetry();
      this.emit({
        phase: "available",
        deferred: true,
        message: "当前正在进行实时语音或屏幕分享，更新下载将在空闲时开始。",
        latestVersion: this.lastResult?.latestVersion,
        forceUpdate: this.lastResult?.forceUpdate,
      });
      return;
    }
    this.pendingBackgroundDownload = false;
    if (this.backgroundDownloadRetryTimer) clearTimeout(this.backgroundDownloadRetryTimer);
    this.backgroundDownloadRetryTimer = undefined;
    this.downloadStarted = true;
    this.emit({
      phase: "downloading",
      deferred: false,
      message: "正在准备更新…",
      percent: 0,
      latestVersion: this.lastResult?.latestVersion,
      forceUpdate: this.lastResult?.forceUpdate,
    });
    try {
      await autoUpdater.checkForUpdates();
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.downloadStarted = false;
      throw error;
    }
  }

  private scheduleBackgroundDownloadRetry(): void {
    if (this.backgroundDownloadRetryTimer || !this.pendingBackgroundDownload) return;
    this.backgroundDownloadRetryTimer = setTimeout(() => {
      this.backgroundDownloadRetryTimer = undefined;
      if (!this.pendingBackgroundDownload) return;
      void this.download(false).catch((error) => {
        void this.log("warn", "deferred update download could not start", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 5_000);
    this.backgroundDownloadRetryTimer.unref();
  }

  async install(): Promise<void> {
    if (!app.isPackaged || this.installStarted) {
      return;
    }
    if (!this.downloadReady) {
      this.emit({
        phase: "error",
        message: "新版还没有下载完成，请稍后再试。",
        latestVersion: this.lastResult?.latestVersion,
      });
      return;
    }
    this.installStarted = true;
    this.emit({ phase: "installing", message: "正在安装新版…" });
    try {
      await this.prepareInstallHandoff();
    } catch (error) {
      void this.log("warn", "update presence handoff was not acknowledged", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    void this.log("info", "starting user-confirmed update install handoff");
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      this.installStarted = false;
      this.emit({ phase: "error", message: "自动安装没有启动，请稍后重试。" });
      void this.log("error", "silent automatic update install failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private prepareInstallHandoff(): Promise<void> {
    if (!this.installHandoffPromise) {
      this.installHandoffPromise = Promise.resolve(this.beforeInstall?.());
    }
    return this.installHandoffPromise;
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
    await this.writeLog?.({ category: "updates", level, message, context }).catch(() => undefined);
  }
}
