import { request } from "node:https";

import { shell } from "electron";
import semver from "semver";

import {
  DEFAULT_RELEASES_URL,
  type RendererLogPayload,
  type UpdateCheckResult,
} from "@private-voice/shared";

const RELEASES_API_URL =
  "https://api.github.com/repos/soberbw-hash/shanghao/releases/latest";

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
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
    req.setTimeout(4_000, () => {
      req.destroy(new Error("update_check_timeout"));
    });
    req.end();
  });

export class UpdateService {
  constructor(
    private readonly currentVersion: string,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async check(): Promise<UpdateCheckResult> {
    try {
      const release = await fetchJson<GitHubReleaseResponse>(RELEASES_API_URL);
      const latestVersion = release.tag_name?.replace(/^v/i, "") || undefined;
      const hasUpdate = Boolean(
        latestVersion &&
          semver.valid(latestVersion) &&
          semver.gt(latestVersion, this.currentVersion),
      );

      const result: UpdateCheckResult = {
        currentVersion: this.currentVersion,
        latestVersion,
        hasUpdate,
        checkedAt: new Date().toISOString(),
        releaseUrl: release.html_url || DEFAULT_RELEASES_URL,
        message: hasUpdate
          ? `发现新版本 ${latestVersion}`
          : latestVersion
            ? "当前已经是最新版本"
            : "暂时无法判断是否有新版本",
      };

      await this.writeLog?.({
        category: "updates",
        level: "info",
        message: "update check completed",
        context: result as unknown as Record<string, unknown>,
      });

      return result;
    } catch (error) {
      const result: UpdateCheckResult = {
        currentVersion: this.currentVersion,
        hasUpdate: false,
        checkedAt: new Date().toISOString(),
        releaseUrl: DEFAULT_RELEASES_URL,
        message: "检查更新失败，请稍后再试。",
      };

      await this.writeLog?.({
        category: "updates",
        level: "warn",
        message: "update check failed",
        context: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return result;
    }
  }

  async openReleases(): Promise<void> {
    await shell.openExternal(DEFAULT_RELEASES_URL);
  }
}
