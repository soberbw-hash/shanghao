/** Keeps legacy personal entries usable while removing manual dictionary upkeep from the flow. */
export function RecordingGameContext({
  game,
  terms,
  savedTermCount,
}: {
  game: string;
  terms: string;
  automatic: boolean;
  disabled: boolean;
  onGame: (value: string) => void;
  onTerms: (value: string) => void;
  onAutomatic: (value: boolean) => void;
  onSaveDictionary: () => void;
  savedTermCount: number;
}) {
  const detectedGame = game.trim();
  return (
    <section className="recording-game-context" aria-label="游戏词汇自动适配">
      <strong>游戏词汇自动适配</strong>
      <p>
        本地识别和房间纪事会按房间成员当时的游戏自动匹配常见词汇；云端识别是否支持热词由服务商决定
        {detectedGame ? `。${detectedGame}已匹配 ${savedTermCount} 个词。` : "。"}
        {terms.trim() && !detectedGame ? "以前保存的个人词条仍会保留。" : ""}
      </p>
    </section>
  );
}

export function parseRecordingGameContext(game: string, terms: string) {
  const gameName = game.trim();
  const words = terms
    .split(/[,，\n]/u)
    .map((term) => term.trim())
    .filter(Boolean);
  const safe = (value: string, maximum: number) =>
    value.length <= maximum && /^[\p{L}\p{N} .+_-]+$/u.test(value);
  if (
    (gameName && !safe(gameName, 40)) ||
    words.length > 16 ||
    words.some((term) => !safe(term, 20))
  )
    throw new Error("invalid_asr_context");
  if (!gameName && !words.length) return undefined;
  return { ...(gameName ? { gameName } : {}), terms: words };
}
