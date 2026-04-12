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
          ? `\u53D1\u73B0\u65B0\u7248\u672C ${latestVersion}`
          : latestVersion
            ? "\u5F53\u524D\u5DF2\u7ECF\u662F\u6700\u65B0\u7248\u672C"
            : "\u6682\u65F6\u65E0\u6CD5\u5224\u65AD\u662F\u5426\u6709\u65B0\u7248\u672C",
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
        message: "\u68C0\u67E5\u66F4\u65B0\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002",
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
