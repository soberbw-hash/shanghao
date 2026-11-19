import { isIP } from "node:net";
import { fetchPublicUrl, readPublicResponse } from "./public-network";
import { readChatLinkMetadata } from "./chat-link-metadata";

export interface ChatLinkPreview {
  title?: string;
  description?: string;
  siteName?: string;
  imageDataUrl?: string;
  imageKind?: "cover" | "icon";
}

const MAX_HTML_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const cache = new Map<string, Promise<ChatLinkPreview>>();

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
  const response = await fetchPublicUrl(
    url,
    {
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: maxBytes === MAX_HTML_BYTES ? "text/html" : "image/*" },
    },
    "link_preview_address_not_allowed",
  );
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    await response.body?.cancel();
    return readPublicResource(new URL(location, url).href, maxBytes, redirects + 1);
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error("link_preview_response_rejected");
  }
  return {
    body: await readPublicResponse(response, maxBytes),
    contentType: (response.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase(),
    finalUrl: url,
  };
};

const loadPreview = async (url: URL, imagePreference?: "icon"): Promise<ChatLinkPreview> => {
  const page = await readPublicResource(url.href, MAX_HTML_BYTES).catch(() => undefined);
  if (!page && url.hostname !== "v.douyin.com") return {};
  const base = page?.finalUrl ?? url;
  const html = page?.contentType === "text/html" ? page.body.toString("utf8") : "";
  const { image: rawImage, ...metadata } = readChatLinkMetadata(html);
  const icon = html.match(/<link\s+[^>]*rel\s*=\s*["'][^"']*\bicon\b[^"']*["'][^>]*>/i)?.[0];
  const iconHref = icon?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  const hasDouyinIcon = url.hostname === "v.douyin.com" || base.hostname === "www.douyin.com";
  const candidates = [
    ...(imagePreference !== "icon" && rawImage ? [{ href: rawImage, kind: "cover" as const }] : []),
    ...(iconHref ? [{ href: iconHref, kind: "icon" as const }] : []),
    {
      href: hasDouyinIcon ? "https://www.douyin.com/favicon.ico" : "/favicon.ico",
      kind: "icon" as const,
    },
  ];
  for (const { href, kind } of candidates) {
    try {
      const image = await readPublicResource(
        new URL(href.replace(/&amp;/g, "&"), base).href,
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
        ...metadata,
        imageKind: kind,
        imageDataUrl: `data:${image.contentType};base64,${image.body.toString("base64")}`,
      };
    } catch {
      // A missing Open Graph image can still have a normal site icon.
    }
  }
  return page ? metadata : {};
};

export const getChatLinkPreview = (
  raw: string,
  imagePreference?: "icon",
): Promise<ChatLinkPreview> => {
  if (raw.length > 2_048) return Promise.resolve({});
  let url: URL;
  try {
    url = validatedUrl(raw);
  } catch {
    return Promise.resolve({});
  }
  const key = `${imagePreference ?? "cover"}:${url.href}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const task = loadPreview(url, imagePreference).catch(() => ({}));
  cache.set(key, task);
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return task;
};
