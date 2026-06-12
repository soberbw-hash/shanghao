import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DirectHostProbeSummary, RendererLogPayload } from "@private-voice/shared";

import { resolveLanIpv4Candidates, resolvePublicIpv6Candidates } from "./network-addresses";
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

interface ResolvedReachabilityState {
  reachability: DirectHostProbeSummary["reachability"];
  natTendency: DirectHostProbeSummary["natTendency"];
  message: string;
}

const detectPublicIp = async (): Promise<string | undefined> => {
  try {
    const response = await fetch("https://api64.ipify.org?format=json", {
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { ip?: string };
    return data.ip;
  } catch {
    return undefined;
  }
};

export const resolveDirectHostReachability = ({
  selectedHost,
  probeSucceeded,
  addressSource,
  manualHost,
  publicIp,
  upnpMapped,
  natPmpMapped,
}: {
  selectedHost?: string;
  probeSucceeded: boolean;
  addressSource: DirectHostProbeSummary["addressSource"];
  manualHost?: string;
  publicIp?: string;
  upnpMapped: boolean;
  natPmpMapped: boolean;
}): ResolvedReachabilityState => {
  if (selectedHost && addressSource === "lan_ipv4") {
    return {
      reachability: "reachable",
      natTendency: "mapping_required",
      message:
        "房间已启动，局域网地址已准备好。同一网络下的好友可以加入，跨网络好友不能使用该地址。",
    };
  }

  if (probeSucceeded && selectedHost) {
    return {
      reachability: "reachable",
      natTendency: "direct_friendly",
      message: "房间已启动，公网直连可用，现在可以直接把地址发给好友。",
    };
  }

  if (selectedHost) {
    const usedPortMapping = upnpMapped || natPmpMapped;
    return {
      reachability: "unverified",
      natTendency: usedPortMapping
        ? "mapping_required"
        : publicIp || manualHost
          ? "restricted"
          : "unknown",
      message: usedPortMapping
        ? "端口映射已完成，但公网地址仍未验证，不会把候选地址自动分享给跨网络好友。"
        : "已找到候选公网地址，但当前无法验证外网可达，建议使用临时公网、云中继或 Tailscale。",
    };
  }

  return {
    reachability: "unreachable",
    natTendency: publicIp ? "restricted" : "unknown",
    message: "房间已启动，但当前网络拿不到可分享地址，建议使用临时公网、云中继或 Tailscale。",
  };
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
  const publicIpv6Candidates = resolvePublicIpv6Candidates();
  const interfacePublicIpv6 = publicIpv6Candidates[0];
  const localHost = candidates[0];

  const trimmedManual = manualHost?.trim() || undefined;
  const publicIp = await detectPublicIp();
  await log("info", "direct host public ip detected", { publicIp });

  // Try UPnP mapping first.
  const upnp = localHost
    ? await tryUpnpMapping(localPort, localHost)
    : { attempted: false, mapped: false, error: "未找到可用的本机 IPv4 地址" };
  if (upnp.cleanup) cleanupTasks.push(upnp.cleanup);

  // Try NAT-PMP as a fallback.
  const natPmp =
    localHost && !upnp.mapped
      ? await tryNatPmpMapping(localPort, localHost)
      : { attempted: false, mapped: false };
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
  } else if (interfacePublicIpv6) {
    selectedHost = interfacePublicIpv6;
    addressSource = "public_ip";
  } else if (localHost) {
    selectedHost = localHost;
    addressSource = "lan_ipv4";
  }

  const probeSucceeded =
    selectedHost && addressSource !== "lan_ipv4"
      ? await probePort(selectedHost, localPort, 2_000).catch(() => false)
      : false;
  const { reachability, natTendency, message } = resolveDirectHostReachability({
    selectedHost,
    probeSucceeded,
    addressSource,
    manualHost: trimmedManual,
    publicIp,
    upnpMapped: upnp.mapped,
    natPmpMapped: natPmp.mapped,
  });

  const summary: DirectHostProbeSummary = {
    publicIp: publicIp || interfacePublicIpv6,
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
    publicIpv6Candidates,
  });

  return { summary, cleanupTasks };
};
