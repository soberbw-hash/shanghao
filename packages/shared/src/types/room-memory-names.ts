/** Only standalone, direct identity statements are treated as name mappings. */
export const roomMemoryNames = (manual: string, automatic = ""): Map<string, string> => {
  const parse = (text: string) => {
    const names = new Map<string, Set<string>>();
    for (const clause of text.split(/[，,。；;\n]/u)) {
      const match = clause
        .trim()
        .match(/^([A-Za-z0-9_@.-]{2,32})\s*(?:就是|是|=|＝)\s*([\p{Script=Han}·]{2,16})$/u);
      if (!match) continue;
      const key = match[1]!.toLowerCase();
      const values = names.get(key) ?? new Set<string>();
      values.add(match[2]!);
      names.set(key, values);
    }
    return names;
  };
  const names = parse(automatic);
  for (const [key, values] of parse(manual)) names.set(key, values);
  return new Map(
    [...names].flatMap(([key, values]) =>
      values.size === 1 ? [[key, [...values][0]!] as const] : [],
    ),
  );
};

export const applyRoomMemoryNames = (text: string, names: ReadonlyMap<string, string>): string => {
  if (!names.size) return text;
  let result = "";
  let cursor = 0;
  for (const { 0: token, index } of text.matchAll(
    /https?:\/\/[^\s，。！？；]+|[A-Za-z0-9_@.-]+/gu,
  )) {
    if (index < cursor) continue;
    let nicknameLength = token.length;
    while (nicknameLength > 0 && token[nicknameLength - 1] === ".") nicknameLength--;
    const nickname = token.slice(0, nicknameLength);
    const name = names.get(nickname.toLowerCase());
    if (!name) continue;
    const end = index + token.length;
    const suffix = token.slice(nicknameLength);
    const duplicate = text.slice(end).match(/^[ \t]*[（(]([\p{Script=Han}·]{2,16})[）)]/u);
    result += text.slice(cursor, index) + name + suffix;
    cursor = !suffix && duplicate?.[1] === name ? end + duplicate[0].length : end;
  }
  return result + text.slice(cursor);
};
