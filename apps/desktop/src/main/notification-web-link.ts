export function notificationWebLink(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 2048) return;
  try {
    const url = new URL(input);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password)
      return url.href;
  } catch {
    // The original message remains accessible in room chat.
  }
}
