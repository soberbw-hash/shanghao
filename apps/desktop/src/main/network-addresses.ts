import net from "node:net";
import { networkInterfaces } from "node:os";

const BLOCKED_INTERFACE_KEYWORDS = ["clash", "meta", "mihomo", "wintun", "tun", "tap", "warp"];
const PREFERRED_INTERFACE_KEYWORDS = [
  "ethernet",
  "wi-fi",
  "wifi",
  "wlan",
  "lan",
  "eth",
  "以太网",
  "本地连接",
];

const isBlockedAddress = (address: string): boolean =>
  address.startsWith("127.") || address.startsWith("198.18.") || address.startsWith("198.19.");

const isPrivateLanIpv4 = (address: string): boolean =>
  /^10\./.test(address) ||
  /^192\.168\./.test(address) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);

const isGlobalUnicastIpv6 = (address: string): boolean => {
  const normalized = address.split("%")[0]?.toLowerCase() ?? "";

  return (
    net.isIP(normalized) === 6 &&
    !normalized.startsWith("::1") &&
    !normalized.startsWith("fe80:") &&
    !normalized.startsWith("fc") &&
    !normalized.startsWith("fd") &&
    !normalized.startsWith("ff") &&
    !normalized.startsWith("2001:db8:")
  );
};

const isTailscaleIpv4 = (address: string): boolean => {
  const [octetA, octetB] = address.split(".").map((segment) => Number(segment));
  return (
    octetA === 100 &&
    typeof octetB === "number" &&
    Number.isFinite(octetB) &&
    octetB >= 64 &&
    octetB <= 127
  );
};

const getInterfaceScore = (name: string, address: string): number => {
  const normalized = name.toLowerCase();
  let score = 0;

  if (isPrivateLanIpv4(address)) {
    score += 100;
  }

  if (PREFERRED_INTERFACE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    score += 40;
  }

  if (BLOCKED_INTERFACE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    score -= 60;
  }

  if (normalized.includes("tailscale")) {
    score -= 100;
  }

  if (normalized.includes("loopback")) {
    score -= 200;
  }

  return score;
};

const getPublicIpv6Score = (name: string, address: string): number => {
  let score = getInterfaceScore(name, address) + 120;

  if (address.includes(":")) {
    score += 20;
  }

  return score;
};

export const formatHostForUrl = (host: string): string => {
  const trimmed = host.trim();
  if (net.isIP(trimmed) === 6 && !trimmed.startsWith("[") && !trimmed.endsWith("]")) {
    return `[${trimmed}]`;
  }

  return trimmed;
};

export const resolveLanIpv4Candidates = (): string[] => {
  const interfaces = networkInterfaces();
  const candidates: Array<{ address: string; score: number }> = [];

  for (const [name, values] of Object.entries(interfaces)) {
    for (const value of values ?? []) {
      const isIpv4 = value.family === "IPv4";
      if (
        isIpv4 &&
        !value.internal &&
        !isBlockedAddress(value.address) &&
        !isTailscaleIpv4(value.address)
      ) {
        candidates.push({
          address: value.address,
          score: getInterfaceScore(name, value.address),
        });
      }
    }
  }

  return [...new Set(candidates.sort((left, right) => right.score - left.score).map((item) => item.address))];
};

export const resolvePublicIpv6Candidates = (): string[] => {
  const interfaces = networkInterfaces();
  const candidates: Array<{ address: string; score: number }> = [];

  for (const [name, values] of Object.entries(interfaces)) {
    for (const value of values ?? []) {
      const address = value.address.split("%")[0] ?? value.address;
      if (!value.internal && isGlobalUnicastIpv6(address)) {
        candidates.push({
          address,
          score: getPublicIpv6Score(name, address),
        });
      }
    }
  }

  return [...new Set(candidates.sort((left, right) => right.score - left.score).map((item) => item.address))];
};

export const isIpv6Address = (host: string): boolean =>
  net.isIP(host.replace(/^\[/, "").replace(/\]$/, "")) === 6;
