export interface WindowsToastContent {
  title: string;
  body: string;
  silent?: boolean;
  actions?: readonly string[];
  logoUrl?: string;
  image?: { url: string; placement: "hero" | "inline"; alt?: string };
}

const escapeXml = (value: string) =>
  value
    .replace(/[\uD800-\uDFFF]/gu, "\uFFFD")
    // eslint-disable-next-line no-control-regex -- XML 1.0 excludes these control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");

export function windowsToastXml(content: WindowsToastContent, id: string): string {
  const tag = escapeXml(id);
  const logo = content.logoUrl
    ? `<image placement="appLogoOverride" src="${escapeXml(content.logoUrl)}"/>`
    : "";
  const { image } = content;
  const illustration = image
    ? `<image${image.placement === "hero" ? ' placement="hero"' : ""} src="${escapeXml(image.url)}"${image.alt ? ` alt="${escapeXml(image.alt)}"` : ""}/>`
    : "";
  const buttons = (content.actions ?? [])
    .map(
      (label, index) =>
        `<action content="${escapeXml(label)}" arguments="type=action&amp;action=${index}&amp;tag=${tag}" activationType="foreground"/>`,
    )
    .join("");
  return `<toast launch="type=click&amp;tag=${tag}"><visual><binding template="ToastGeneric">
    <text>${escapeXml(content.title)}</text><text>${escapeXml(content.body)}</text>
    ${logo}${illustration}</binding></visual>${buttons ? `<actions>${buttons}</actions>` : ""}
    ${content.silent ? '<audio silent="true"/>' : ""}</toast>`;
}
