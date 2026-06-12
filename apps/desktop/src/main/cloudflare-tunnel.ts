import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, chmod, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { CloudflareTunnelStatus, RendererLogPayload } from "@private-voice/shared";

const TUNNEL_START_TIMEOUT_MS = 45_000;
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

export class CloudflareTunnelController {
  private process?: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(status: CloudflareTunnelStatus) => void>();
  private status: CloudflareTunnelStatus = {
    isInstalled: false,
    processState: "idle",
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
      this.setStatus({
        isInstalled: true,
        processState: "active",
        tunnelUrl,
        tunnelStartedAt: new Date().toISOString(),
        message: "临时公网地址已准备好，关闭房间后地址会失效。",
      });
      await this.writeLog({
        category: "cloudflare-tunnel",
        level: "info",
        message: "Cloudflare quick tunnel active",
        context: { tunnelUrl, localPort },
      });
      return this.getSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        processState: "failed",
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

      const inspectOutput = (raw: Buffer) => {
        const text = raw.toString();
        const match = text.match(TRY_CLOUDFLARE_URL_PATTERN);
        if (match?.[0]) {
          finish(match[0]);
        }
      };

      child.stdout.on("data", inspectOutput);
      child.stderr.on("data", inspectOutput);
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
        const message = `cloudflared_exited:${code ?? "unknown"}`;
        this.setStatus({
          processState: "failed",
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
}
