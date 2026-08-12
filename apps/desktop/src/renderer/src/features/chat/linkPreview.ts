const urlPattern = /https?:\/\/[^\s<，。！？；：）】》」]+/gi;
const trailingUrlPunctuation = /[.,!?，。！？;；:：)\]}>》」】]+$/;

const parseMessageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

export const findFirstMessageUrl = (content: string) => {
  const rawValue = content.match(urlPattern)?.[0];
  if (!rawValue) return undefined;
  const value = rawValue.replace(trailingUrlPunctuation, "");
  return parseMessageUrl(value) ? value : undefined;
};

export const isMessageOnlyUrl = (content: string) => {
  const url = findFirstMessageUrl(content);
  if (!url) return false;
  return content.trim().replace(trailingUrlPunctuation, "") === url;
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
