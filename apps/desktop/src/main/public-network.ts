import { promises as dns, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

const abortableResolution = <T>(pending: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });

/** Fail closed for mapped/transition IPv6, multicast, reserved and private addresses. */
export const isPublicNetworkAddress = (address: string): boolean => {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
};

export const resolvePublicAddress = async (url: URL, code: string): Promise<LookupAddress> => {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    /(^|\.)(localhost|local|internal)$/.test(hostname) ||
    hostname.endsWith(".home.arpa")
  )
    throw new Error(code);
  const family = isIP(hostname);
  let addresses = family
    ? [{ address: hostname, family }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  // Clash fake-IP is not a public destination. Resolve it independently, then pin
  // a real public address instead of trusting or connecting to the fake address.
  if (
    !family &&
    addresses.length &&
    addresses.every(({ address }) => /^198\.(18|19)\./.test(address))
  ) {
    const resolver = new URL("https://dns.alidns.com/resolve");
    resolver.search = new URLSearchParams({ name: hostname, type: "A" }).toString();
    const response = await fetch(resolver, {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    const answer = JSON.parse((await readPublicResponse(response, 16_384)).toString("utf8")) as {
      Status?: number;
      Answer?: Array<{ type: number; data: string }>;
    };
    if (!response.ok || answer.Status !== 0 || !Array.isArray(answer.Answer)) throw new Error(code);
    addresses = answer.Answer.filter((item) => item.type === 1 && isIP(item.data) === 4).map(
      (item) => ({ address: item.data, family: 4 }),
    );
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicNetworkAddress(address)))
    throw new Error(code);
  return addresses.find((item) => item.family === 4) ?? addresses[0]!;
};

/** Pin the checked address to the socket; retain the URL host for HTTP and TLS. */
export const fetchPublicUrl = async (
  input: string | URL,
  init: RequestInit = {},
  code = "public_network_address_not_allowed",
): Promise<Response> => {
  const url = new URL(input);
  const signal = init.signal ?? AbortSignal.timeout(60_000);
  signal.throwIfAborted();
  const address = await abortableResolution(resolvePublicAddress(url, code), signal);
  signal.throwIfAborted();
  const payload = new Request(url, { ...init, signal });
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: payload.method,
        headers: Object.fromEntries(payload.headers),
        agent: false,
        family: address.family,
        signal,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400 && init.redirect !== "manual") {
          response.destroy();
          reject(new Error("public_network_redirect_not_allowed"));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        const empty = [204, 205, 304].includes(status);
        resolve(
          new Response(empty ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>), {
            status,
            headers,
          }),
        );
        if (empty) response.resume();
      },
    );
    request.on("error", reject);
    if (payload.body) {
      const body = Readable.fromWeb(payload.body as import("node:stream/web").ReadableStream);
      body.on("error", (error) => request.destroy(error));
      request.on("close", () => body.destroy());
      body.pipe(request);
    } else request.end();
  });
};

export const readPublicResponse = async (response: Response, maximum: number): Promise<Buffer> => {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new Error("public_network_response_too_large");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("public_network_response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
};
