const urlPattern = /(?:https?:\/\/[^\s<，。！？；：）】》」]+|\bv\.douyin\.com\/[\w-]+\/?)/gi;
const trailingUrlPunctuation = /[.,!?，。！？;；:：)\]}>》」】]+$/;

const parseMessageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

export const messageLinkCard = (content: string) => {
  const matches = content.match(urlPattern);
  if (matches?.length !== 1) return undefined;
  const address = matches[0]!.replace(trailingUrlPunctuation, "");
  const url = parseMessageUrl(address.includes("://") ? address : `https://${address}`);
  if (!url) return undefined;
  let caption = content.replace(matches[0]!, "").trim();
  if (url.hostname === "v.douyin.com" && caption.includes("复制此链接")) {
    caption = caption
      .replace(/复制此链接[\s\S]*$/, "")
      .replace(/^\d+\.\d+\s+[^\n]{0,65}?:\/\s*/, "")
      .trim();
  }
  return {
    url: url.href,
    caption: caption.replace(trailingUrlPunctuation, "").trim() ? caption : undefined,
  };
};

export const formatCompactUrl = (value: string) => {
  const url = parseMessageUrl(value);
  if (!url) return value;
  const hostname = url.hostname.replace(/^www\./, "");
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const compact = `${hostname}${pathname}`;
  return compact.length > 42 ? `${compact.slice(0, 39)}…` : compact;
};

export const getMessageUrlDetails = (value: string) => {
  const url = parseMessageUrl(value);
  if (!url) return undefined;
  const hostname = url.hostname.replace(/^www\./, "");
  return {
    hostname,
  };
};
