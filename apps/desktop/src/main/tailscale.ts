import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

import { shell } from "electron";

import { TailscaleState, type TailscaleStatus } from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const TAILSCALE_INSTALL_URL = "https://tailscale.com/download/windows";

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
  source: "magicdns" | "tailscale_ip" | "lan_ip";
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

const resolveLanIpv4 = (): string | undefined => {
  const interfaces = networkInterfaces();
  for (const values of Object.values(interfaces)) {
    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal) {
        return value.address;
      }
    }
  }

  return undefined;
};

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
    const ip = parsed.Self?.TailscaleIPs?.[0];
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

export const resolvePreferredHostAddress = async (): Promise<HostAddressResolution | undefined> => {
  const tailscale = await detectTailscaleStatus();
  const candidates: HostAddressResolution[] = [];

  if (tailscale.magicDnsName) {
    candidates.push({
      host: tailscale.magicDnsName,
      source: "magicdns",
      alternatives: [tailscale.ip, resolveLanIpv4()].filter(
        (value): value is string => Boolean(value),
      ),
    });
  }

  if (tailscale.ip) {
    candidates.push({
      host: tailscale.ip,
      source: "tailscale_ip",
      alternatives: [tailscale.magicDnsName, resolveLanIpv4()].filter(
        (value): value is string => Boolean(value),
      ),
    });
  }

  const lanIp = resolveLanIpv4();
  if (lanIp) {
    candidates.push({
      host: lanIp,
      source: "lan_ip",
      alternatives: [tailscale.magicDnsName, tailscale.ip].filter(
        (value): value is string => Boolean(value),
      ),
    });
  }

  return candidates[0];
};

export const openTailscaleInstallGuide = async (): Promise<void> => {
  await shell.openExternal(TAILSCALE_INSTALL_URL);
};
