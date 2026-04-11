import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

import { shell } from "electron";

import { TailscaleState, type TailscaleStatus } from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const TAILSCALE_INSTALL_URL = "https://tailscale.com/download/windows";
const BLOCKED_INTERFACE_KEYWORDS = ["clash", "meta", "mihomo", "wintun", "tun", "tap", "warp"];

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
    await execFileAsync("where", ["tailscale"], { windowsHide: true });
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

const isBlockedAddress = (address: string): boolean => {
  return (
    address.startsWith("127.") ||
    address.startsWith("198.18.") ||
    address.startsWith("198.19.")
  );
};

const isBlockedInterface = (name: string): boolean =>
  BLOCKED_INTERFACE_KEYWORDS.some((keyword) => name.toLowerCase().includes(keyword));

export const detectTailscaleStatus = async (): Promise<TailscaleStatus> => {
  if (!(await detectBinary())) {
    return {
      state: TailscaleState.NotInstalled,
      isInstalled: false,
      isConnected: false,
      message: "这台设备还没有安装 Tailscale。",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  }

  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout) as TailscaleStatusJson;
    const ip = parsed.Self?.TailscaleIPs?.find((candidate) => !isBlockedAddress(candidate));
    const magicDnsName = normalizeMagicDnsName(parsed.Self?.DNSName);
    const backendState = parsed.BackendState?.toLowerCase();
    const isConnected = backendState === "running" || Boolean(ip);

    return {
      state: isConnected ? TailscaleState.Connected : TailscaleState.Disconnected,
      isInstalled: true,
      isConnected,
      hostname: parsed.Self?.HostName,
      tailnet: parsed.CurrentTailnet?.Name,
      ip,
      magicDnsName,
      message: isConnected
        ? "Tailscale 已连接，可以直接用于好友房间。"
        : "Tailscale 已安装，但当前设备还没有连到你的 tailnet。",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  } catch {
    return {
      state: TailscaleState.Installed,
      isInstalled: true,
      isConnected: false,
      message: "Tailscale 已安装，但暂时无法读取当前状态。",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  }
};

export const resolveTailscaleAddress = async (): Promise<HostAddressResolution | undefined> => {
  const tailscale = await detectTailscaleStatus();
  const candidates: HostAddressResolution[] = [];

  if (tailscale.magicDnsName) {
    candidates.push({
      host: tailscale.magicDnsName,
      source: "magicdns",
      alternatives: [tailscale.ip].filter((value): value is string => Boolean(value)),
    });
  }

  if (tailscale.ip) {
    candidates.push({
      host: tailscale.ip,
      source: "tailscale_ip",
      alternatives: [tailscale.magicDnsName].filter((value): value is string => Boolean(value)),
    });
  }

  return candidates[0];
};

export const resolveLanIpv4Candidates = (): string[] => {
  const interfaces = networkInterfaces();
  const candidates: string[] = [];

  for (const [name, values] of Object.entries(interfaces)) {
    if (isBlockedInterface(name)) {
      continue;
    }

    for (const value of values ?? []) {
      if (
        value.family === "IPv4" &&
        !value.internal &&
        !isBlockedAddress(value.address)
      ) {
        candidates.push(value.address);
      }
    }
  }

  return [...new Set(candidates)];
};

export const openTailscaleInstallGuide = async (): Promise<void> => {
  await shell.openExternal(TAILSCALE_INSTALL_URL);
};
