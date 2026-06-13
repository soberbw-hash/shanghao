import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, chmod, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { CloudflareTunnelStatus, RendererLogPayload } from "@private-voice/shared";

const TUNNEL_START_TIMEOUT_MS = 45_000;
const HEALTH_CHECK_INTERVAL_MS = 20_000;
const HEALTH_CHECK_TIMEOUT_MS = 6_000;
const MAX_HEALTH_FAILURES = 3;
const execFileAsync = promisify(execFile);
const TRY_CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const downloadUrls: Partial<Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, string>>>> = {
  win32: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe",
  },
  darwin: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
  },
  linux: {
    x64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    arm64: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64",
  },
};

const downloadWithCurl = async (url: string, destination: string): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(
      "curl",
      ["-L", "--fail", "--retry", "4", "--retry-all-errors", "--connect-timeout", "15", "-o", destination, url],
      { windowsHide: true },
    );
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });

const downloadFile = async (url: string, destination: string): Promise<void> => {
  const temporaryPath = `${destination}.download`;
  if (await downloadWithCurl(url, temporaryPath)) {
    await unlink(destination).catch(() => undefined);
    await rename(temporaryPath, destination);
    return;
  }

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`cloudflared_download_failed:${response.status}`);
  }

  const file = await import("node:fs").then(({ createWriteStream }) => createWriteStream(temporaryPath));
  await new Promise<void>((resolve, reject) => {
    const readable = import("node:stream").then(({ Readable }) => Readable.fromWeb(response.body as never));
    void readable.then((stream) => {
      stream.pipe(file);
      stream.once("error", reject);
      file.once("error", reject);
      file.once("finish", resolve);
    });
  });
  await unlink(destination).catch(() => undefined);
  await rename(temporaryPath, destination);
};

const readCommandVersion = async (command: string): Promise<string | undefined> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], {
      windowsHide: true,
    });
    return `${stdout}${stderr}`.trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
};

const trimOutput = (value: string): string => value.trim().slice(-1_000);

export class CloudflareTunnelController {
  private process?: ChildProcessWithoutNullStreams;
  private healthTimer?: NodeJS.Timeout;
  private activeTunnelUrl?: string;
  private healthFailures = 0;
  private readonly listeners = new Set<(status: CloudflareTunnelStatus) => void>();
  private status: CloudflareTunnelStatus = {
    isInstalled: false,
    processState: "idle",
    healthState: "idle",
    consecutiveHealthFailures: 0,
    message: "临时公网尚未启动。",
  };

  constructor(
    private readonly binaryDirectory: string,
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  getSnapshot(): CloudflareTunnelStatus {
    return { ...this.status };
  }

  onStatusChange(listener: (status: CloudflareTunnelStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(localPort: number): Promise<CloudflareTunnelStatus> {
    await this.stop();
    this.setStatus({
      processState: "starting",
      healthState: "idle",
      consecutiveHealthFailures: 0,
      message: "正在创建临时公网隧道…",
      lastError: undefined,
      lastExitCode: undefined,
      tunnelUrl: undefined,
      tunnelStartedAt: undefined,
      processPid: undefined,
    });

    try {
      const binaryPath = await this.resolveBinary();
      const tunnelUrl = await this.spawnTunnel(binaryPath, localPort);
      this.activeTunnelUrl = tunnelUrl;
      this.healthFailures = 0;
      this.setStatus({
        isInstalled: true,
        processState: "active",
        healthState: "healthy",
        consecutiveHealthFailures: 0,
        tunnelUrl,
        tunnelStartedAt: new Date().toISOString(),
        message: "临时公网地址已生成。",
      });
      this.startHealthChecks(tunnelUrl);
      await this.writeLog({
        category: "cloudflare-tunnel",
        level: "info",
        message: "Cloudflare quick tunnel active",
        context: { tunnelUrl, localPort, processPid: this.process?.pid },
      });
      return this.getSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        processState: "failed",
        healthState: "failed",
        processPid: undefined,
        lastError: message,
        message: "临时公网隧道创建失败，请重试或切换到云中继。",
      });
      await this.writeLog({
        category: "cloudflare-tunnel",
        level: "error",
        message: "Cloudflare quick tunnel failed",
        context: { error: message, localPort },
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopHealthChecks();
    this.activeTunnelUrl = undefined;
    this.healthFailures = 0;
    const child = this.process;
    this.process = undefined;
    if (child && !child.killed) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    if (this.status.processState !== "idle") {
      this.setStatus({
        processState: "stopped",
        healthState: "idle",
        consecutiveHealthFailures: 0,
        tunnelUrl: undefined,
        processPid: undefined,
        message: "临时公网隧道已停止。",
      });
      await this.writeLog({
        category: "cloudflare-tunnel",
        level: "info",
        message: "Cloudflare quick tunnel stopped",
      });
    }
  }

  private setStatus(patch: Partial<CloudflareTunnelStatus>): void {
    this.status = { ...this.status, ...patch };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async resolveBinary(): Promise<string> {
    const installedVersion = await readCommandVersion("cloudflared");
    if (installedVersion) {
      this.setStatus({ isInstalled: true, version: installedVersion });
      return "cloudflared";
    }

    const executableName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    const binaryPath = path.join(this.binaryDirectory, executableName);
    if (await access(binaryPath).then(() => true).catch(() => false)) {
      this.setStatus({
        isInstalled: true,
        version: await readCommandVersion(binaryPath),
      });
      return binaryPath;
    }

    const downloadUrl = downloadUrls[process.platform]?.[process.arch];
    if (!downloadUrl) {
      throw new Error("当前系统暂不支持自动下载 cloudflared，请先手动安装 cloudflared。");
    }

    this.setStatus({
      processState: "downloading",
      message: "首次使用正在下载临时公网组件…",
    });
    await mkdir(this.binaryDirectory, { recursive: true });
    if (downloadUrl.endsWith(".tgz")) {
      const archivePath = path.join(this.binaryDirectory, "cloudflared.tgz");
      await downloadFile(downloadUrl, archivePath);
      await execFileAsync("tar", ["-xzf", archivePath, "-C", this.binaryDirectory]);
      await unlink(archivePath).catch(() => undefined);
    } else {
      await downloadFile(downloadUrl, binaryPath);
    }
    if (process.platform !== "win32") {
      await chmod(binaryPath, 0o755);
    }
    this.setStatus({
      isInstalled: true,
      version: await readCommandVersion(binaryPath),
    });
    return binaryPath;
  }

  private async spawnTunnel(binaryPath: string, localPort: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        binaryPath,
        ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${localPort}`],
        { windowsHide: true },
      );
      this.process = child;
      this.setStatus({ processPid: child.pid });
      let settled = false;
      const timeout = setTimeout(() => finish(new Error("cloudflared_tunnel_start_timeout")), TUNNEL_START_TIMEOUT_MS);

      const finish = (result: string | Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (result instanceof Error) {
          if (this.process === child) {
            this.process = undefined;
          }
          child.kill();
          reject(result);
        } else {
          resolve(result);
        }
      };

      const inspectOutput = (stream: "stdout" | "stderr", raw: Buffer) => {
        const text = trimOutput(raw.toString());
        if (!text) {
          return;
        }
        this.setStatus(stream === "stdout" ? { lastStdout: text } : { lastStderr: text });
        void this.writeLog({
          category: "cloudflare-tunnel",
          level: stream === "stderr" && /\b(error|failed|disconnect)\b/i.test(text) ? "warn" : "info",
          message: `cloudflared ${stream}`,
          context: { output: text },
        });
        const match = text.match(TRY_CLOUDFLARE_URL_PATTERN);
        if (match?.[0]) {
          finish(match[0]);
        }
      };

      child.stdout.on("data", (raw: Buffer) => inspectOutput("stdout", raw));
      child.stderr.on("data", (raw: Buffer) => inspectOutput("stderr", raw));
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (!settled) {
          finish(new Error(`cloudflared_exited:${code ?? "unknown"}`));
          return;
        }
        if (this.process !== child) {
          return;
        }
        this.process = undefined;
        this.stopHealthChecks();
        this.activeTunnelUrl = undefined;
        const message = `cloudflared_exited:${code ?? "unknown"}`;
        this.setStatus({
          processState: "failed",
          healthState: "failed",
          tunnelUrl: undefined,
          processPid: undefined,
          lastExitCode: code,
          lastError: message,
          message: "临时公网隧道已断开，请重新开房。",
        });
        void this.writeLog({
          category: "cloudflare-tunnel",
          level: "error",
          message: "Cloudflare quick tunnel exited unexpectedly",
          context: { code, localPort },
        });
      });
    });
  }

  private startHealthChecks(tunnelUrl: string): void {
    this.stopHealthChecks();
    const check = () => void this.checkHealth(tunnelUrl);
    this.healthTimer = setInterval(check, HEALTH_CHECK_INTERVAL_MS);
    check();
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  private async checkHealth(tunnelUrl: string): Promise<void> {
    if (!this.process || this.activeTunnelUrl !== tunnelUrl) {
      return;
    }

    const checkedAt = new Date().toISOString();
    try {
      const healthUrl = new URL("/health", tunnelUrl);
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      const payload = response.ok ? (await response.json().catch(() => undefined)) as { ok?: unknown } | undefined : undefined;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(`health_check_failed:${response.status}`);
      }

      const wasDegraded = this.healthFailures > 0 || this.status.processState === "failed";
      this.healthFailures = 0;
      this.setStatus({
        processState: "active",
        healthState: "healthy",
        consecutiveHealthFailures: 0,
        lastHealthCheckAt: checkedAt,
        tunnelUrl,
        lastError: undefined,
        message: "临时公网地址已生成。",
      });
      await this.writeLog({
        category: "cloudflare-tunnel",
        level: "info",
        message: wasDegraded ? "Cloudflare quick tunnel health recovered" : "Cloudflare quick tunnel health check passed",
        context: { tunnelUrl, checkedAt },
      });
    } catch (error) {
      this.healthFailures += 1;
      const isFailed = this.healthFailures >= MAX_HEALTH_FAILURES;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setStatus({
        processState: isFailed ? "failed" : "active",
        healthState: isFailed ? "failed" : "degraded",
        consecutiveHealthFailures: this.healthFailures,
        lastHealthCheckAt: checkedAt,
        tunnelUrl: isFailed ? undefined : tunnelUrl,
        lastError: errorMessage,
        message: isFailed
          ? "临时公网隧道已断开，请重新开房。"
          : "临时公网连接有波动，正在确认…",
      });
      await this.writeLog({
        category: "cloudflare-tunnel",
        level: isFailed ? "error" : "warn",
        message: "Cloudflare quick tunnel health check failed",
        context: {
          tunnelUrl,
          checkedAt,
          consecutiveFailures: this.healthFailures,
          maxFailures: MAX_HEALTH_FAILURES,
          error: errorMessage,
        },
      });
    }
  }
}
