import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { shell } from "electron";

import { TailscaleState, type TailscaleStatus } from "@private-voice/shared";

const execFileAsync = promisify(execFile);

const TAILSCALE_INSTALL_URLS: Record<string, string> = {
  darwin: "https://tailscale.com/download/mac",
  win32: "https://tailscale.com/download/windows",
  linux: "https://tailscale.com/download/linux",
};

const TAILSCALE_FALLBACK_URL = "https://tailscale.com/download/linux";

const getTailscaleInstallUrl = (): string => {
  const url = TAILSCALE_INSTALL_URLS[process.platform];
  return url ?? TAILSCALE_FALLBACK_URL;
};

interface TailscaleStatusJson {
  BackendState?: string;
  Self?: {
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: string[];
  };
  CurrentTailnet?: {
    Name?: string;
  };
}

export interface HostAddressResolution {
  host: string;
  source: "magicdns" | "tailscale_ip" | "public_ip" | "manual_public_host" | "relay";
  alternatives: string[];
}

const detectBinary = async (): Promise<boolean> => {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    await execFileAsync(command, ["tailscale"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

const normalizeMagicDnsName = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.endsWith(".") ? value.slice(0, -1) : value;
};

const isBlockedAddress = (address: string): boolean =>
  address.startsWith("127.") || address.startsWith("198.18.") || address.startsWith("198.19.");

const isTailscaleIpv4 = (address: string): boolean => {
  const [first, second] = address.split(".").map(Number);
  return first === 100 && typeof second === "number" && Number.isFinite(second) && second >= 64 && second <= 127;
};

export const detectTailscaleStatus = async (): Promise<TailscaleStatus> => {
  if (!(await detectBinary())) {
    return {
      state: TailscaleState.NotInstalled,
      isInstalled: false,
      isConnected: false,
      message: "这台设备还没有安装 Tailscale。",
      installUrl: getTailscaleInstallUrl(),
    };
  }

  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout) as TailscaleStatusJson;
    const ip = parsed.Self?.TailscaleIPs?.find(
      (candidate) => isTailscaleIpv4(candidate) && !isBlockedAddress(candidate),
    );
    const magicDnsName = normalizeMagicDnsName(parsed.Self?.DNSName);
    const backendState = parsed.BackendState?.toLowerCase();
    const isConnected = backendState === "running" && Boolean(ip);
    const message =
      backendState === "needslogin"
        ? "Tailscale 需要登录，请先登录同一个 tailnet。"
        : backendState === "stopped"
          ? "Tailscale 已停止，请先启动 Tailscale。"
          : backendState === "running" && !ip
            ? "Tailscale 正在运行，但没有拿到可用的 100.x 地址，请稍后重试。"
            : isConnected
              ? "Tailscale 已连接，优先使用稳定的 100.x 地址。"
              : "Tailscale 暂未连接，请稍后重试。";

    return {
      state: isConnected ? TailscaleState.Connected : TailscaleState.Disconnected,
      isInstalled: true,
      isConnected,
      hostname: parsed.Self?.HostName,
      tailnet: parsed.CurrentTailnet?.Name,
      ip,
      magicDnsName,
      message,
      installUrl: getTailscaleInstallUrl(),
    };
  } catch {
    return {
      state: TailscaleState.Installed,
      isInstalled: true,
      isConnected: false,
      message: "Tailscale 已安装，但暂时无法读取当前状态。",
      installUrl: getTailscaleInstallUrl(),
    };
  }
};

export const resolveTailscaleAddress = async (): Promise<HostAddressResolution | undefined> => {
  const tailscale = await detectTailscaleStatus();

  if (tailscale.ip) {
    return {
      host: tailscale.ip,
      source: "tailscale_ip",
      alternatives: [tailscale.magicDnsName].filter((value): value is string => Boolean(value)),
    };
  }

  if (tailscale.magicDnsName && tailscale.isConnected) {
    return {
      host: tailscale.magicDnsName,
      source: "magicdns",
      alternatives: [],
    };
  }

  return undefined;
};

export const openTailscaleInstallGuide = async (): Promise<void> => {
  await shell.openExternal(getTailscaleInstallUrl());
};
