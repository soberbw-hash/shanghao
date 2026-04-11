import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { request } from "node:https";

import type { NetworkStatusSnapshot, ProxyDiagnostics } from "@private-voice/shared";

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

  return {
    hasSystemProxy,
    proxyDescription: normalizedProxyDescription || "未检测到显式系统代理",
    hasTunAdapter: tunAdapterNames.length > 0,
    tunAdapterNames,
    hasClashLikeAdapter: tunAdapterNames.some((name) =>
      ["clash", "meta", "mihomo", "wintun"].some((keyword) =>
        name.toLowerCase().includes(keyword),
      ),
    ),
    directBypassEnabled: true,
    message:
      hasSystemProxy || tunAdapterNames.length > 0
        ? "检测到代理/TUN 环境，已启用房间连接直连兼容模式。"
        : "当前未检测到会影响房间连接的代理/TUN 环境。",
  };
};

export const getNetworkStatusSnapshot = async (): Promise<NetworkStatusSnapshot> => {
  const [tailscale, proxy, publicIp] = await Promise.all([
    detectTailscaleStatus().catch(() => undefined),
    detectProxyDiagnostics().catch(() => undefined),
    detectPublicIp().catch(() => undefined),
  ]);

  return {
    tailscale,
    proxy,
    publicIp,
  };
};
