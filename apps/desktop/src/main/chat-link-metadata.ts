const readableText = (value?: string, limit = 240): string | undefined => {
  if (!value) return undefined;
  const entities: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  const text = value
    .replace(
      /&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt|nbsp);/gi,
      (raw, numeric: string, name: string) => {
        if (!numeric) return entities[name.toLowerCase()] ?? raw;
        const code =
          numeric[0]?.toLowerCase() === "x"
            ? Number.parseInt(numeric.slice(1), 16)
            : Number(numeric);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : "";
      },
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, limit) || undefined;
};

export const readChatLinkMetadata = (html: string) => {
  const metadata = new Map<string, string>();
  for (const tag of html.match(/<meta\s+[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    const name = (attributes.get("property") ?? attributes.get("name"))?.toLowerCase();
    if (name && attributes.get("content")) metadata.set(name, attributes.get("content")!);
  }
  return {
    title: readableText(
      metadata.get("og:title") ??
        metadata.get("twitter:title") ??
        html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
      100,
    ),
    description: readableText(
      metadata.get("og:description") ??
        metadata.get("description") ??
        metadata.get("twitter:description"),
    ),
    siteName: readableText(metadata.get("og:site_name"), 60),
    image: metadata.get("og:image") ?? metadata.get("twitter:image"),
  };
};
