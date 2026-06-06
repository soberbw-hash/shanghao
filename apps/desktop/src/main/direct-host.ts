import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DirectHostProbe, ReachabilityReport } from "@private-voice/shared";

import { resolveLanIpv4Candidates } from "./network-addresses";
import { probePort } from "./port-probe";

const execFileAsync = promisify(execFile);

interface MappingAttemptResult {
  attempted: boolean;
  mapped: boolean;
  externalIp?: string;
  error?: string;
  cleanup?: () => Promise<void>;
}

interface HostAddress {
  host: string;
  source: "lan_ip" | "manual_public_host" | "public_ip" | "unknown";
}

const pickPrimaryIp = (
  hosts: { address: string }[],
): string | undefined => {
  const primary = hosts.find(() => true);
  return primary?.address;
};

export const createDirectHostProbe = async ({
  port,
}: {
  port: number;
}): Promise<DirectHostProbe> => {
  const candidates = resolveLanIpv4Candidates();
  const primaryHost = candidates[0];
  const primaryAddress = primaryHost?.address ?? "0.0.0.0";

  const start = async (signal?: AbortSignal) => {
    const defaultExternalHost = await detectPublicIp().catch(() => undefined);
    return buildReport(
      primaryAddress,
      defaultExternalHost,
      undefined,
    );
  };

  const probe = async (host: string, signal?: AbortSignal) => {
    return probePort(host, port, signal);
  };

  const stop = async () => {
    // nothing to clean up for direct connections
  };

  return { start, probe, stop, port };
};

const resolveDefaultGateway = async (): Promise<string | undefined> => {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1 -ExpandProperty NextHop)",
        ],
        { windowsHide: true },
      );
      const gateway = stdout.trim();
      return gateway || undefined;
    }

    // macOS / Linux: parse route output
    const { stdout } = await execFileAsync("sh", [
      "-c",
      "route -n get default 2>/dev/null | awk '/gateway:/ {print $2}' || ip route show default 2>/dev/null | awk '/default via/ {print $3}'",
    ]);
    const gateway = stdout.trim();
    return gateway || undefined;
  } catch {
    return undefined;
  }
};

const detectPublicIp = async (): Promise<string | undefined> => {
  try {
    const response = await fetch("https://api64.ipify.org?format=json");
    const data = (await response.json()) as { ip?: string };
    return data.ip;
  } catch {
    return undefined;
  }
};

const loadNatPortMapper = async (): Promise<typeof import("@achingbrain/nat-port-mapper")> => {
  const dynamicImporter = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<typeof import("@achingbrain/nat-port-mapper")>;
  return dynamicImporter("@achingbrain/nat-port-mapper");
};

const tryUpnpMapping = async (
  localPort: number,
  localHost: string,
): Promise<MappingAttemptResult> => {
  try {
    const { upnpNat } = await loadNatPortMapper();
    const gateway = upnpNat();

    const mapping = await gateway.map(localPort, localHost, {
      externalPort: localPort,
      protocol: "tcp",
      description: "ShangHao",
      ttl: 3_600_000,
    });

    if (mapping.externalPort) {
      return {
        attempted: true,
        mapped: true,
        cleanup: async () => {
          await gateway.unmap(localPort).catch(() => undefined);
          await gateway.stop().catch(() => undefined);
        },
      };
    }

    return {
      attempted: true,
      mapped: false,
      error: "未发现可用的 UPnP 网关",
    };
  } catch (error) {
    return {
      attempted: true,
      mapped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const tryNatPmpMapping = async (
  localPort: number,
  localHost: string,
): Promise<MappingAttemptResult> => {
  const gatewayAddress = await resolveDefaultGateway();
  if (!gatewayAddress) {
    return {
      attempted: false,
      mapped: false,
      error: "未找到默认网关，跳过 NAT-PMP",
    };
  }

  try {
    const { pmpNat } = await loadNatPortMapper();
    const gateway = pmpNat(gatewayAddress);
    const mapping = await gateway.map(localPort, localHost, {
      externalPort: localPort,
      protocol: "tcp",
      description: "ShangHao",
      ttl: 3_600_000,
    });
    const externalIp = await gateway.externalIp().catch(() => undefined);
    return {
      attempted: true,
      mapped: Boolean(mapping.externalPort),
      externalIp,
      cleanup: async () => {
        await gateway.unmap(localPort).catch(() => undefined);
        await gateway.stop().catch(() => undefined);
      },
    };
  } catch (error) {
    return {
      attempted: true,
      mapped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildReport = async (
  localHost: string,
  publicIp?: string,
  manualHost?: string,
): Promise<ReachabilityReport> => {
  const selectedHost = manualHost || publicIp || localHost;

  if (selectedHost) {
    return {
      reachability: "unverified" as const,
      natTendency: "unknown" as const,
      message: "房间已启动，已生成候选地址。请让好友尝试连接；如不通请切换 Tailscale 或云中继。",
    };
  }

  return {
    reachability: "unreachable" as const,
    natTendency: "unknown" as const,
    message: "房间已启动，但当前网络暂时拿不到可分享地址，建议改用 Tailscale 或云中继。",
  };
};
