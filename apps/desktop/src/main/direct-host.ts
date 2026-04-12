import { request } from "node:https";
import { execFile } from "node:child_process";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

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
      error: "\u672A\u53D1\u73B0\u53EF\u7528\u7684 UPnP \u7F51\u5173",
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
      error: "\u672A\u627E\u5230\u9ED8\u8BA4\u7F51\u5173\uFF0C\u8DF3\u8FC7 NAT-PMP",
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
  const localHost = resolveLocalLanAddress();
  const normalizedManualHost = manualHost?.trim() || undefined;
  const publicIp = await detectPublicIp();
  const upnp = localHost
    ? await tryUpnpMapping(localPort, localHost)
    : {
        attempted: false,
        mapped: false,
        error: "\u672A\u627E\u5230\u53EF\u7528\u7684\u672C\u673A IPv4 \u5730\u5740",
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
      ? "\u5DF2\u83B7\u53D6\u516C\u7F51\u5730\u5740\uFF0C\u7AEF\u53E3\u5DF2\u53EF\u8FBE\uFF0C\u53EF\u4EE5\u76F4\u63A5\u5206\u4EAB\u3002"
      : upnp.mapped || natPmp.mapped
        ? "\u5DF2\u5C1D\u8BD5\u7AEF\u53E3\u6620\u5C04\uFF0C\u516C\u7F51\u53EF\u8FBE\u6027\u4ECD\u5F85\u9A8C\u8BC1\u3002"
        : normalizedManualHost
          ? "\u5DF2\u4F7F\u7528\u624B\u52A8\u516C\u7F51\u5730\u5740\uFF0C\u8BF7\u786E\u8BA4\u8DEF\u7531\u5668\u7AEF\u53E3\u6620\u5C04\u5DF2\u7ECF\u751F\u6548\u3002"
          : "\u5F53\u524D\u7F51\u7EDC\u4E0D\u6EE1\u8DB3\u623F\u4E3B\u76F4\u8FDE\u6761\u4EF6\uFF0C\u5EFA\u8BAE\u6539\u7528 Tailscale \u6216\u4E91\u4E2D\u7EE7\u3002";

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
