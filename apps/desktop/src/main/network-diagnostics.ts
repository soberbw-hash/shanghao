import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { request } from "node:https";
import { promisify } from "node:util";

import type {
  AppSettings,
  DiagnosticsBundleSummary,
  NetworkStatusSnapshot,
  ProxyDiagnostics,
  RendererLogPayload,
} from "@private-voice/shared";

import { readRelayStatus } from "./relay-status";
import { detectTailscaleStatus } from "./tailscale";

const execFileAsync = promisify(execFile);
const TUN_KEYWORDS = ["clash", "meta", "mihomo", "wintun", "tun", "tap", "warp"];

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

export const detectProxyDiagnostics = async (): Promise<ProxyDiagnostics> => {
  const interfaces = Object.keys(networkInterfaces());
  const tunAdapterNames = interfaces.filter((name) =>
    TUN_KEYWORDS.some((keyword) => name.toLowerCase().includes(keyword)),
  );

  let proxyDescription = "";
  try {
    const result = await execFileAsync("netsh", ["winhttp", "show", "proxy"], {
      windowsHide: true,
    });
    proxyDescription = result.stdout.trim();
  } catch {
    proxyDescription = "";
  }

  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy;

  const normalizedProxyDescription = [proxyDescription, envProxy].filter(Boolean).join(" | ");
  const hasSystemProxy =
    Boolean(envProxy) ||
    /Proxy Server/i.test(proxyDescription) ||
    /Direct access/i.test(proxyDescription) === false;

  const hasTunAdapter = tunAdapterNames.length > 0;
  const hasClashLikeAdapter = tunAdapterNames.some((name) =>
    ["clash", "meta", "mihomo", "wintun"].some((keyword) =>
      name.toLowerCase().includes(keyword),
    ),
  );

  return {
    hasSystemProxy,
    proxyDescription: normalizedProxyDescription || "未检测到显式系统代理",
    hasTunAdapter,
    tunAdapterNames,
    hasClashLikeAdapter,
    directBypassEnabled: true,
    compatibilityModeEnabled: hasSystemProxy || hasTunAdapter,
    message:
      hasSystemProxy || hasTunAdapter
        ? "检测到代理 / TUN 环境，已自动启用房间连接直连兼容模式。"
        : "当前未检测到会影响房间连接的代理 / TUN 环境。",
  };
};

const summarizeDirectHost = (
  settings: AppSettings,
  publicIp?: string,
): NetworkStatusSnapshot["directHost"] => ({
  publicIp,
  manualHost: settings.manualDirectHost,
  selectedHost: settings.manualDirectHost || publicIp,
  selectedPort: 43821,
  addressSource: settings.manualDirectHost ? "manual_public_host" : publicIp ? "public_ip" : "unknown",
  upnpAttempted: false,
  upnpMapped: false,
  natPmpAttempted: false,
  natPmpMapped: false,
  reachability: settings.manualDirectHost || publicIp ? "unverified" : "unreachable",
  natTendency: settings.manualDirectHost || publicIp ? "mapping_required" : "unknown",
  message:
    settings.manualDirectHost || publicIp
      ? "已准备公网地址，开房时会继续做端口映射与可达性探测。"
      : "还没有可用的公网直连地址。",
});

export const getNetworkStatusSnapshot = async (
  settings?: AppSettings,
  writeLog?: (payload: RendererLogPayload) => Promise<void>,
): Promise<NetworkStatusSnapshot> => {
  const [tailscale, proxy, publicIp, relay] = await Promise.all([
    detectTailscaleStatus().catch(() => undefined),
    detectProxyDiagnostics().catch(() => undefined),
    detectPublicIp().catch(() => undefined),
    readRelayStatus({
      relayServerUrl: settings?.relayServerUrl,
      writeLog,
    }).catch(() => undefined),
  ]);

  return {
    tailscale,
    proxy,
    publicIp,
    relay,
    directHost: settings ? summarizeDirectHost(settings, publicIp) : undefined,
  };
};

export const buildDiagnosticsSummary = async ({
  settings,
  appVersion,
  protocolVersion,
  buildNumber,
  inviteAddress,
  writeLog,
}: {
  settings: AppSettings;
  appVersion?: string;
  protocolVersion?: string;
  buildNumber?: string;
  inviteAddress?: string;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
}): Promise<DiagnosticsBundleSummary> => {
  const networkSnapshot = await getNetworkStatusSnapshot(settings, writeLog);
  return {
    appVersion,
    protocolVersion,
    buildNumber,
    connectionMode: settings.connectionMode,
    inviteAddress,
    proxy: networkSnapshot.proxy,
    tailscale: networkSnapshot.tailscale,
    directHost: networkSnapshot.directHost,
    relay: networkSnapshot.relay,
    exportedAt: new Date().toISOString(),
  };
};
