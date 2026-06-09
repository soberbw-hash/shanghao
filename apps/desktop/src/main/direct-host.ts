import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DirectHostProbeSummary, RendererLogPayload } from "@private-voice/shared";

import { resolveLanIpv4Candidates } from "./network-addresses";
import { probePort } from "./port-probe";

const execFileAsync = promisify(execFile);

interface NatPortMapper {
  findGateways?: (
    options?: { signal?: AbortSignal },
  ) => AsyncIterable<UpnpGateway>;
}

interface UpnpGateway {
  map: (
    port: number,
    host: string,
    options?: Record<string, unknown>,
  ) => Promise<{ externalPort?: number; externalHost?: string }>;
  unmap: (port: number) => Promise<void>;
  externalIp: () => Promise<string>;
  stop: () => Promise<void>;
}

interface PmpGateway {
  map: (
    port: number,
    host: string,
    options?: Record<string, unknown>,
  ) => Promise<{ externalPort?: number; externalHost?: string }>;
  unmap: (port: number) => Promise<void>;
  externalIp: () => Promise<string>;
  stop: () => Promise<void>;
}

type CleanupTask = () => Promise<void>;

const detectPublicIp = async (): Promise<string | undefined> => {
  try {
    const response = await fetch("https://api64.ipify.org?format=json");
    if (!response.ok) return undefined;
    const data = (await response.json()) as { ip?: string };
    return data.ip;
  } catch {
    return undefined;
  }
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

const tryUpnpMapping = async (
  localPort: number,
  localHost: string,
): Promise<{
  attempted: boolean;
  mapped: boolean;
  externalIp?: string;
  cleanup?: CleanupTask;
  error?: string;
}> => {
  try {
    const mod = (await import("@achingbrain/nat-port-mapper")) as unknown as {
      upnpNat?: () => NatPortMapper;
    };
    if (!mod.upnpNat) {
      return { attempted: true, mapped: false, error: "nat-port-mapper 未提供 upnpNat" };
    }
    const client = mod.upnpNat();
    if (!client.findGateways) {
      return { attempted: true, mapped: false, error: "nat-port-mapper 缺少 findGateways" };
    }

    for await (const gateway of client.findGateways({
      signal: AbortSignal.timeout(5_000),
    })) {
      const mapping = await gateway.map(localPort, localHost, {
        protocol: "tcp",
        description: "ShangHao",
        ttl: 3_600_000,
      });
      if (!mapping?.externalPort) continue;
      const externalIp = await gateway.externalIp().catch(() => undefined);
      return {
        attempted: true,
        mapped: true,
        externalIp,
        cleanup: async () => {
          await gateway.unmap(localPort).catch(() => undefined);
          await gateway.stop().catch(() => undefined);
        },
      };
    }

    return { attempted: true, mapped: false, error: "未发现可用的 UPnP 网关" };
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
): Promise<{
  attempted: boolean;
  mapped: boolean;
  externalIp?: string;
  cleanup?: CleanupTask;
  error?: string;
}> => {
  const gatewayAddress = await resolveDefaultGateway();
  if (!gatewayAddress) {
    return {
      attempted: false,
      mapped: false,
      error: "未找到默认网关，跳过 NAT-PMP",
    };
  }

  try {
    const mod = (await import("@achingbrain/nat-port-mapper")) as unknown as {
      pmpNat?: (addr: string) => PmpGateway;
    };
    if (!mod.pmpNat) {
      return { attempted: true, mapped: false, error: "nat-port-mapper 未提供 pmpNat" };
    }
    const gateway = mod.pmpNat(gatewayAddress);
    const mapping = await gateway.map(localPort, localHost, {
      protocol: "tcp",
      description: "ShangHao",
      ttl: 3_600_000,
    });
    const externalIp = await gateway.externalIp().catch(() => undefined);
    return {
      attempted: true,
      mapped: Boolean(mapping?.externalPort),
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

export interface DirectHostProbeResult {
  summary: DirectHostProbeSummary;
  cleanupTasks: CleanupTask[];
}

export const probeDirectHost = async ({
  localPort,
  manualHost,
  writeLog,
}: {
  localPort: number;
  manualHost?: string;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
}): Promise<DirectHostProbeResult> => {
  const cleanupTasks: CleanupTask[] = [];
  const log = async (
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ) => {
    await writeLog?.({ category: "connection-mode", level, message, context });
  };

  const candidates = resolveLanIpv4Candidates();
  const localHost = candidates[0] ?? "127.0.0.1";

  const trimmedManual = manualHost?.trim() || undefined;
  const publicIp = await detectPublicIp();
  await log("info", "direct host public ip detected", { publicIp });

  // Try UPnP mapping first.
  const upnp = await tryUpnpMapping(localPort, localHost);
  if (upnp.cleanup) cleanupTasks.push(upnp.cleanup);

  // Try NAT-PMP as a fallback.
  const natPmp = upnp.mapped
    ? { attempted: false, mapped: false }
    : await tryNatPmpMapping(localPort, localHost);
  if (natPmp.cleanup) cleanupTasks.push(natPmp.cleanup);

  // Pick the best host we can offer.
  let selectedHost: string | undefined;
  let addressSource: DirectHostProbeSummary["addressSource"] = "unknown";

  if (trimmedManual) {
    selectedHost = trimmedManual;
    addressSource = "manual_public_host";
  } else if (upnp.mapped && upnp.externalIp) {
    selectedHost = upnp.externalIp;
    addressSource = "public_ip";
  } else if (natPmp.mapped && natPmp.externalIp) {
    selectedHost = natPmp.externalIp;
    addressSource = "public_ip";
  } else if (publicIp) {
    selectedHost = publicIp;
    addressSource = "public_ip";
  } else if (localHost) {
    selectedHost = localHost;
    addressSource = "lan_ipv4";
  }

  // Probe the public reachability of whatever we picked (best effort, 2s).
  let reachability: DirectHostProbeSummary["reachability"] = "unverified";
  if (selectedHost && addressSource !== "lan_ipv4") {
    const ok = await probePort(selectedHost, localPort, 2_000).catch(() => false);
    reachability = ok ? "reachable" : "unreachable";
  } else if (addressSource === "lan_ipv4") {
    reachability = "unverified";
  } else {
    reachability = "unreachable";
  }

  const natTendency: DirectHostProbeSummary["natTendency"] = upnp.mapped || natPmp.mapped
    ? "mapping_required"
    : addressSource === "public_ip"
      ? "direct_friendly"
      : addressSource === "lan_ipv4"
        ? "restricted"
        : "unknown";

  const message = (() => {
    if (trimmedManual) {
      return reachability === "reachable"
        ? "手动公网地址已确认可达。好友可以直接复制使用。"
        : "已使用手动公网地址，但当前无法从外网验证可达，建议同时准备 Tailscale 兜底。";
    }
    if (upnp.mapped || natPmp.mapped) {
      return "已通过网关映射建立端口转发，可直接分享当前地址。";
    }
    if (addressSource === "public_ip" && reachability === "reachable") {
      return "公网直连已确认可用，可直接分享当前地址。";
    }
    if (addressSource === "public_ip") {
      return "已拿到公网 IP，但当前无法从外网验证端口可达，建议改用 Tailscale 或云中继。";
    }
    if (addressSource === "lan_ipv4") {
      return "房间已启动，同一局域网下的好友可以直接加入；公网直连仍未确认可用，如跨网络连接失败，请手动做端口映射或改用云中继。";
    }
    return "房间已启动，但当前网络暂时拿不到可分享地址，建议改用 Tailscale 或云中继。";
  })();

  const summary: DirectHostProbeSummary = {
    publicIp,
    manualHost: trimmedManual,
    selectedHost,
    selectedPort: localPort,
    addressSource,
    upnpAttempted: upnp.attempted,
    upnpMapped: upnp.mapped,
    natPmpAttempted: natPmp.attempted,
    natPmpMapped: natPmp.mapped,
    reachability,
    natTendency,
    message,
  };

  await log("info", "direct host probe summary", {
    addressSource,
    reachability,
    natTendency,
    upnpMapped: upnp.mapped,
    natPmpMapped: natPmp.mapped,
    selectedHost,
  });

  return { summary, cleanupTasks };
};
