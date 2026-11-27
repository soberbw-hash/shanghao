const MAX_STORIES = 3;
export const MAX_CHRONICLE_STORY_LENGTH = 140;

export function cleanChronicleSpeech(text: string): string {
  const clean = text
    .replace(
      /<\|(?:BGM|Music|Speech|Applause|Laughter|Cry|Cough|Sneeze|Breath|EMO_UNKNOWN|HAPPY|SAD|ANGRY|NEUTRAL|withitn|woitn|nospeech|[a-z]{2,3})\|>/giu,
      " ",
    )
    .replace(/[🎼🎵🎶👏🤧😊😡😔😭😀]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  // Standalone hesitation and recognition markers carry no context. Keep short
  // answers such as "不行", "对" or "可以" for the model to interpret in context.
  const tokens = clean
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);
  if (
    !tokens.length ||
    tokens.every((token) => /^(?:[嗯啊哦呃唉欸诶哎额呀哈]+|ah|uh|um|hmm|erm)$/u.test(token))
  )
    return "";
  return clean.slice(0, 2000);
}

/** A spelling candidate needs both a matching sound and an explicit technical topic. */
export function chronicleSpellingHints(text: string): string[] {
  if (!/(?:开源模型|语言模型|大模型|模型|AI\s*工具|API|GPT|额度|服务器)/iu.test(text)) return [];
  const spelling: string[] = [];
  if (/(?:\bkimi\b|\bk[\s-]*[米咪])/iu.test(text)) spelling.push("Kimi");
  if (/\bdot\b/iu.test(text)) spelling.push("Dot");
  return spelling;
}

interface ChronicleEvidence {
  at: number;
  text: string;
}

const comparableQuote = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");

export function readChronicleStories(content: string, evidence: readonly ChronicleEvidence[]) {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object") throw Error("chronicle_invalid_summary");
  let candidates: unknown[];
  if ("stories" in parsed && Array.isArray(parsed.stories))
    candidates = parsed.stories.slice(0, MAX_STORIES);
  else if ("text" in parsed && typeof parsed.text === "string")
    candidates = [{ text: parsed.text, sourceIds: evidence.map((_, index) => index + 1) }];
  else throw Error("chronicle_invalid_summary");
  const published = new Set<string>();
  const stories: Array<{ at: number; text: string }> = [];
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("text" in candidate) ||
      typeof candidate.text !== "string" ||
      !("sourceIds" in candidate) ||
      !Array.isArray(candidate.sourceIds)
    )
      continue;
    const text = candidate.text.replace(/\s+/gu, " ").trim();
    if (!text || text.length > MAX_CHRONICLE_STORY_LENGTH || published.has(text)) continue;
    const ids: unknown[] = candidate.sourceIds;
    const sources = ids
      .filter(
        (id): id is number =>
          typeof id === "number" && Number.isInteger(id) && id > 0 && id <= evidence.length,
      )
      .map((id) => evidence[id - 1]!);
    if (!sources.length || sources.length !== ids.length) continue;
    const quotes = [...text.matchAll(/“([^”]+)”|「([^」]+)」|"([^"]+)"/gu)];
    if (
      quotes.some((quote) => {
        const phrase = comparableQuote(quote[1] ?? quote[2] ?? quote[3] ?? "");
        return !phrase || !sources.some((source) => comparableQuote(source.text).includes(phrase));
      })
    )
      continue;
    published.add(text);
    stories.push({ text, at: Math.min(...sources.map((source) => source.at)) });
  }
  return stories.sort((a, b) => a.at - b.at);
}
