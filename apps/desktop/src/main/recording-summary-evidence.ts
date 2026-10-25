import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

/** Remove only known content-free phrases; any remaining concrete wording keeps the item. */
export function isGenericRecordingRecap(text: string): boolean {
  if (!/朋友|大家|队友|成员/.test(text)) return false;
  return !text
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .replace(
      /这段录音|整场录音|这场录音|本次录音|本段录音|本场录音|主要围绕|主要记录了|主要记录|主要是|记录了|本次|朋友之间|朋友间|朋友们|几位朋友|队友们|朋友|大家|队友|成员|一起|之间|进行了|进行|围绕|展开|游戏|聊天|开黑|互动|交流|沟通|战术|策略|整体|比较|非常|轻松|愉快|欢乐|氛围|气氛|配合|默契|吐槽|互损|分享|经历|过程|内容|体验|讨论|调侃|欢声笑语|充满|热烈|热闹|团队|协作|有趣|生动|自然|友好|活跃|为主|以及|彼此|的|与|和|并|在|中|了|等/g,
      "",
    );
}

/** A joke may rephrase evidence, but quoted speech must be present in its cited originals. */
export function hasGroundedRecordingQuotes(
  text: string,
  sources: readonly VoiceMemoryTranscriptSegment[],
): boolean {
  const evidence = sources.map((source) => source.text.replace(/\s/g, ""));
  return [...text.matchAll(/[“「『"]([^”」』"]+)[”」』"]/g)].every(([, quote]) =>
    evidence.some((source) => source.includes(quote!.replace(/\s/g, ""))),
  );
}
