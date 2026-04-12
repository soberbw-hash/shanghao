import { request } from "node:https";
import net from "node:net";
import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

import { pmpNat, upnpNat } from "@achingbrain/nat-port-mapper";

import {
  DEFAULT_SIGNALING_PORT,
  type DirectHostProbeSummary,
  type RendererLogPayload,
} from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const BLOCKED_INTERFACE_KEYWORDS = ["clash", "meta", "mihomo", "wintun", "tun", "tap", "warp"];

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

const isBlockedAddress = (address: string): boolean =>
  address.startsWith("127.") || address.startsWith("198.18.") || address.startsWith("198.19.");

const isBlockedInterface = (name: string): boolean =>
  BLOCKED_INTERFACE_KEYWORDS.some((keyword) => name.toLowerCase().includes(keyword));

const resolveLocalLanAddress = (): string | undefined => {
  const interfaces = networkInterfaces();
  for (const [name, values] of Object.entries(interfaces)) {
    if (isBlockedInterface(name)) {
      continue;
    }

    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal && !isBlockedAddress(value.address)) {
        return value.address;
      }
    }
  }

  return undefined;
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

const tryUpnpMapping = async (
  localPort: number,
  localHost: string,
): Promise<MappingAttemptResult> => {
  const nat = upnpNat();
  try {
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

  const gateway = pmpNat(gatewayAddress);
  try {
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
  const localHost = resolveLocalLanAddress();
  const normalizedManualHost = manualHost?.trim() || undefined;
  const publicIp = await detectPublicIp();
  const upnp = localHost ? await tryUpnpMapping(localPort, localHost) : { attempted: false, mapped: false, error: "未找到可用的本机 IPv4 地址" };
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

  const selectedHost = normalizedManualHost || upnp.externalIp || natPmp.externalIp || publicIp;
  const addressSource = normalizedManualHost
    ? "manual_public_host"
    : upnp.externalIp || natPmp.externalIp || publicIp
      ? "public_ip"
      : "unknown";

  const reachability =
    selectedHost && (await probeTcpPort(selectedHost, localPort))
      ? "reachable"
      : upnp.mapped || natPmp.mapped || normalizedManualHost
        ? "unverified"
        : "unreachable";

  const natTendency =
    reachability === "reachable"
      ? "direct_friendly"
      : upnp.mapped || natPmp.mapped
        ? "mapping_required"
        : publicIp
          ? "restricted"
          : "unknown";

  const message =
    reachability === "reachable"
      ? "已获取公网地址，端口已可达，可以直接分享。"
      : upnp.mapped || natPmp.mapped
        ? "已尝试端口映射，公网可达性仍待验证。"
        : normalizedManualHost
          ? "已使用手动公网地址，请确认路由器端口映射已生效。"
          : "当前网络不满足房主直连条件，建议改用 Tailscale 或云中继。";

  await writeLog?.({
    category: "connection-mode",
    level: reachability === "unreachable" ? "warn" : "info",
    message: "direct host probe completed",
    context: {
      selectedHost,
      localHost,
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
