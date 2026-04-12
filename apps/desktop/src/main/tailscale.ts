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

const isBlockedAddress = (address: string): boolean =>
  address.startsWith("127.") || address.startsWith("198.18.") || address.startsWith("198.19.");

const isBlockedInterface = (name: string): boolean =>
  BLOCKED_INTERFACE_KEYWORDS.some((keyword) => name.toLowerCase().includes(keyword));

export const detectTailscaleStatus = async (): Promise<TailscaleStatus> => {
  if (!(await detectBinary())) {
    return {
      state: TailscaleState.NotInstalled,
      isInstalled: false,
      isConnected: false,
      message: "\u8FD9\u53F0\u8BBE\u5907\u8FD8\u6CA1\u6709\u5B89\u88C5 Tailscale\u3002",
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
        ? "Tailscale \u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u76F4\u63A5\u7528\u4E8E\u597D\u53CB\u623F\u95F4\u3002"
        : "Tailscale \u5DF2\u5B89\u88C5\uFF0C\u4F46\u5F53\u524D\u8BBE\u5907\u8FD8\u6CA1\u6709\u8FDE\u5230\u4F60\u7684 tailnet\u3002",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  } catch {
    return {
      state: TailscaleState.Installed,
      isInstalled: true,
      isConnected: false,
      message: "Tailscale \u5DF2\u5B89\u88C5\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u72B6\u6001\u3002",
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
      if (value.family === "IPv4" && !value.internal && !isBlockedAddress(value.address)) {
        candidates.push(value.address);
      }
    }
  }

  return [...new Set(candidates)];
};

export const openTailscaleInstallGuide = async (): Promise<void> => {
  await shell.openExternal(TAILSCALE_INSTALL_URL);
};
