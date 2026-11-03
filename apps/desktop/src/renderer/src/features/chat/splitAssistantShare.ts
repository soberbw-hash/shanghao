/** Respect the relay's UTF-16 limit without cutting a surrogate pair. */
export const splitAssistantShare = (text: string): string[] => {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of text.trim()) {
    if (chunk.length + character.length > 500) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
};
