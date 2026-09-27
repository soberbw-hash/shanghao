import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { net } from "electron";

export interface ChatLinkPreview {
  title?: string;
  imageDataUrl?: string;
}

const MAX_HTML_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const cache = new Map<string, Promise<ChatLinkPreview>>();

const isPublicIpv4 = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const a = octets[0]!;
  const b = octets[1]!;
  const c = octets[2]!;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
};

const validatedUrl = (raw: string): URL => {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname ||
    isIP(url.hostname) ||
    url.hostname.toLowerCase() === "localhost" ||
    url.hostname.endsWith(".local")
  )
    throw new Error("link_preview_address_not_allowed");
  return url;
};

const readPublicResource = async (
  raw: string,
  maxBytes: number,
  redirects = 0,
): Promise<{ body: Buffer; contentType: string; finalUrl: URL }> => {
  if (redirects > 3) throw new Error("link_preview_redirect_limit");
  const url = validatedUrl(raw);
  const { address, family } = await lookup(url.hostname, { family: 4 });
  if (family !== 4 || !isPublicIpv4(address)) throw new Error("link_preview_address_not_allowed");
  if (typeof net?.request === "function") {
    return new Promise((resolve, reject) => {
      const request = net.request({ url: url.href, redirect: "manual" });
      request.setHeader("Accept", maxBytes === MAX_HTML_BYTES ? "text/html" : "image/*");
      const timeout = setTimeout(() => request.abort(), 5_000);
      let redirected = false;
      request.on("redirect", (_status, _method, target) => {
        redirected = true;
        clearTimeout(timeout);
        request.abort();
        void readPublicResource(target, maxBytes, redirects + 1).then(resolve, reject);
      });
      request.on("response", (response) => {
        if (redirected) return;
        const header = (name: string): string => {
          const value: string | string[] | undefined = response.headers[name];
          return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
        };
        if (response.statusCode !== 200 || Number(header("content-length")) > maxBytes) {
          clearTimeout(timeout);
          request.abort();
          reject(new Error("link_preview_response_rejected"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.abort();
            reject(new Error("link_preview_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          clearTimeout(timeout);
          resolve({
            body: Buffer.concat(chunks),
            contentType: header("content-type").split(";")[0]!.toLowerCase(),
            finalUrl: url,
          });
        });
        response.on("error", reject);
      });
      request.on("error", (error) => {
        clearTimeout(timeout);
        if (!redirected) reject(error);
      });
      request.end();
    });
  }
  return new Promise((resolve, reject) => {
    const requester = url.protocol === "https:" ? https : http;
    const request = requester.get(
      url,
      {
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
        timeout: 5_000,
        headers: {
          "User-Agent": "ShangHao/3 LinkPreview",
          Accept: maxBytes === MAX_HTML_BYTES ? "text/html" : "image/*",
        },
      },
      (response) => {
        const location = response.headers.location;
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          location
        ) {
          response.resume();
          void readPublicResource(new URL(location, url).href, maxBytes, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (
          response.statusCode !== 200 ||
          Number(response.headers["content-length"] ?? 0) > maxBytes
        ) {
          response.resume();
          reject(new Error("link_preview_response_rejected"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new Error("link_preview_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: String(response.headers["content-type"] ?? "")
              .split(";")[0]!
              .toLowerCase(),
            finalUrl: url,
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("link_preview_timeout")));
    request.on("error", reject);
  });
};

const metaValue = (html: string, name: string): string | undefined => {
  for (const tag of html.match(/<meta\s+[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      if (match[1]) attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    if ((attributes.get("property") ?? attributes.get("name"))?.toLowerCase() === name) {
      return attributes.get("content");
    }
  }
  return undefined;
};

const loadPreview = async (raw: string): Promise<ChatLinkPreview> => {
  const page = await readPublicResource(raw, MAX_HTML_BYTES);
  const html = page.contentType === "text/html" ? page.body.toString("utf8") : "";
  const title = metaValue(html, "og:title")?.slice(0, 100);
  const rawImage = metaValue(html, "og:image") ?? metaValue(html, "twitter:image");
  const icon = html.match(/<link\s+[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0];
  const iconHref = icon?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  const candidates = [rawImage, iconHref, "/favicon.ico"].filter((value): value is string =>
    Boolean(value),
  );
  for (const candidate of candidates) {
    try {
      const image = await readPublicResource(
        new URL(candidate.replace(/&amp;/g, "&"), page.finalUrl).href,
        MAX_IMAGE_BYTES,
      );
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/avif",
          "image/gif",
          "image/x-icon",
          "image/vnd.microsoft.icon",
        ].includes(image.contentType)
      )
        continue;
      return {
        title,
        imageDataUrl: `data:${image.contentType};base64,${image.body.toString("base64")}`,
      };
    } catch {
      // A missing Open Graph image can still have a normal site icon.
    }
  }
  return { title };
};

export const getChatLinkPreview = (raw: string): Promise<ChatLinkPreview> => {
  if (raw.length > 2_048) return Promise.resolve({});
  let url: URL;
  try {
    url = validatedUrl(raw);
  } catch {
    return Promise.resolve({});
  }
  const key = url.href;
  const existing = cache.get(key);
  if (existing) return existing;
  const task = loadPreview(key).catch(() => ({}));
  cache.set(key, task);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return task;
};
