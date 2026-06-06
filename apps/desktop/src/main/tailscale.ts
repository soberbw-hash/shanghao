import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { shell } from "electron";

import { TailscaleState, type TailscaleStatus } from "@private-voice/shared";

import { resolveLanIpv4Candidates } from "./network-addresses";

const execFileAsync = promisify(execFile);

const TAILSCALE_INSTALL_URLS: Record<string, string> = {
  darwin: "https://tailscale.com/download/mac",
  win32: "https://tailscale.com/download/windows",
  linux: "https://tailscale.com/download/linux",
};

const getTailscaleInstallUrl = (): string =>
  TAILSCALE_INSTALL_URLS[process.platform] ?? TAILSCALE_INSTALL_URLS.linux;

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

export const openTailscaleInstallGuide = async (): Promise<void> => {
  await shell.openExternal(getTailscaleInstallUrl());
};
