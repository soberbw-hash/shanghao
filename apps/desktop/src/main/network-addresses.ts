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
