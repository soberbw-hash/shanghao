import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
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

const detectBinary = async (): Promise<boolean> => {
  try {
    await execFileAsync("where", ["tailscale"], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

export const detectTailscaleStatus = async (): Promise<TailscaleStatus> => {
  if (!(await detectBinary())) {
    return {
      state: TailscaleState.NotInstalled,
      isInstalled: false,
      isConnected: false,
      message: "Tailscale is not installed on this device.",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  }

  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout) as TailscaleStatusJson;
    const ip = parsed.Self?.TailscaleIPs?.[0];
    const backendState = parsed.BackendState?.toLowerCase();
    const isConnected = backendState === "running" || Boolean(ip);

    return {
      state: isConnected ? TailscaleState.Connected : TailscaleState.Disconnected,
      isInstalled: true,
      isConnected,
      hostname: parsed.Self?.HostName,
      tailnet: parsed.CurrentTailnet?.Name,
      ip,
      message: isConnected
        ? "Tailscale is connected and ready for private room hosting."
        : "Tailscale is installed, but this device is not connected to your tailnet.",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  } catch {
    return {
      state: TailscaleState.Installed,
      isInstalled: true,
      isConnected: false,
      message: "Tailscale is installed, but the current status could not be read.",
      installUrl: TAILSCALE_INSTALL_URL,
    };
  }
};

export const openTailscaleInstallGuide = async (): Promise<void> => {
  await shell.openExternal(TAILSCALE_INSTALL_URL);
};

export const resolvePreferredHostIp = async (): Promise<string | undefined> => {
  const tailscale = await detectTailscaleStatus();
  if (tailscale.ip) {
    return tailscale.ip;
  }

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
