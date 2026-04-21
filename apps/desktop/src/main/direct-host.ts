import { execFile } from "node:child_process";
import { request } from "node:https";
import net from "node:net";
import { promisify } from "node:util";

import {
  DEFAULT_SIGNALING_PORT,
  type DirectHostProbeSummary,
  type RendererLogPayload,
} from "@private-voice/shared";

import { resolveLanIpv4Candidates } from "./network-addresses";

const execFileAsync = promisify(execFile);

interface MappingAttemptResult {
  attempted: boolean;
  mapped: boolean;
  externalIp?: string;
  error?: string;
  cleanup?: () => Promise<void>;
}

export interface DirectHostProbeResult {
  summary: DirectHostProbeSummary;
  cleanupTasks: Array<() => Promise<void>>;
}

interface ResolvedReachabilityState {
  reachability: DirectHostProbeSummary["reachability"];
  natTendency: DirectHostProbeSummary["natTendency"];
  message: string;
}

const detectPublicIp = async (): Promise<string | undefined> =>
  new Promise((resolve) => {
    const req = request("https://api64.ipify.org?format=json", (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { ip?: string };
          resolve(parsed.ip);
        } catch {
          resolve(undefined);
        }
      });
    });

    req.on("error", () => resolve(undefined));
    req.setTimeout(2_500, () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });

const probeTcpPort = async (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(2_500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

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
        "房间已启动，局域网地址已准备好。同一网络下的好友现在就可以加入，公网直连能力仍会继续检测。",
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
        ? "房间已启动，已生成候选公网地址。端口映射已经尝试完成，请让好友从外部网络试连；如果仍然不通，建议切换 Tailscale 或云中继。"
        : manualHost
          ? "房间已启动，已使用你手动填写的公网地址。当前无法在本机确认外网可达，请让好友从外部网络试连；如果仍然不通，请检查端口映射或切换 Tailscale / 云中继。"
          : "房间已启动，已生成候选公网地址。当前无法在本机确认外网可达，请让好友从外部网络试连；如果仍然不通，建议切换 Tailscale 或云中继。",
    };
  }

  return {
    reachability: "unreachable",
    natTendency: publicIp ? "restricted" : "unknown",
    message: "房间已启动，但当前网络暂时拿不到可分享地址，建议改用 Tailscale 或云中继。",
  };
};

const resolveDefaultGateway = async (): Promise<string | undefined> => {
  try {
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
    const nat = upnpNat();
    for await (const gateway of nat.findGateways({ signal: AbortSignal.timeout(3_000) })) {
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

export const probeDirectHost = async ({
  localPort = DEFAULT_SIGNALING_PORT,
  manualHost,
  writeLog,
}: {
  localPort?: number;
  manualHost?: string;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
}): Promise<DirectHostProbeResult> => {
  const cleanupTasks: Array<() => Promise<void>> = [];
  const lanCandidates = resolveLanIpv4Candidates();
  const localHost = lanCandidates[0];
  const normalizedManualHost = manualHost?.trim() || undefined;
  const publicIp = await detectPublicIp();
  const upnp = localHost
    ? await tryUpnpMapping(localPort, localHost)
    : {
        attempted: false,
        mapped: false,
        error: "未找到可用的本机 IPv4 地址",
      };
  const natPmp =
    localHost && !upnp.mapped
      ? await tryNatPmpMapping(localPort, localHost)
      : { attempted: false, mapped: false };

  if (upnp.cleanup) {
    cleanupTasks.push(upnp.cleanup);
  }
  if (natPmp.cleanup) {
    cleanupTasks.push(natPmp.cleanup);
  }

  const selectedHost =
    normalizedManualHost || upnp.externalIp || natPmp.externalIp || publicIp || localHost;
  const addressSource = normalizedManualHost
    ? "manual_public_host"
    : upnp.externalIp || natPmp.externalIp || publicIp
      ? "public_ip"
      : localHost
        ? "lan_ipv4"
        : "unknown";

  const probeSucceeded =
    selectedHost && addressSource !== "lan_ipv4" ? await probeTcpPort(selectedHost, localPort) : false;
  const { reachability, natTendency, message } = resolveDirectHostReachability({
    selectedHost,
    probeSucceeded,
    addressSource,
    manualHost: normalizedManualHost,
    publicIp,
    upnpMapped: upnp.mapped,
    natPmpMapped: natPmp.mapped,
  });

  await writeLog?.({
    category: "connection-mode",
    level: reachability === "unreachable" ? "warn" : "info",
    message: "direct host probe completed",
    context: {
      selectedHost,
      localHost,
      lanCandidates,
      localPort,
      publicIp,
      upnpAttempted: upnp.attempted,
      upnpMapped: upnp.mapped,
      upnpError: upnp.error,
      natPmpAttempted: natPmp.attempted,
      natPmpMapped: natPmp.mapped,
      natPmpError: natPmp.error,
      reachability,
      natTendency,
      addressSource,
    },
  });

  return {
    cleanupTasks,
    summary: {
      publicIp,
      manualHost: normalizedManualHost,
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
    },
  };
};
