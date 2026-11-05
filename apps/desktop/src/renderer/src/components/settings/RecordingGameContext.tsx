/** Manual, per-recording context. The worker ignores it for unsupported models. */
export function RecordingGameContext({
  game,
  terms,
  automatic,
  disabled,
  onGame,
  onTerms,
  onAutomatic,
}: {
  game: string;
  terms: string;
  automatic: boolean;
  disabled: boolean;
  onGame: (value: string) => void;
  onTerms: (value: string) => void;
  onAutomatic: (value: boolean) => void;
}) {
  return (
    <details className="recording-game-context">
      <summary>游戏语境增强（试验）</summary>
      <p>可填写这条录音的游戏和词汇，仅用于千问本地识别；效果仍需实际对比。</p>
      <label className="recording-game-context-auto">
        <input
          type="checkbox"
          checked={automatic}
          disabled={disabled}
          onChange={(event) => onAutomatic(event.target.checked)}
        />
        未手动指定游戏时，尝试使用录音期间的成员游戏记录
      </label>
      <label>
        游戏名称
        <input
          value={game}
          maxLength={40}
          disabled={disabled}
          onChange={(event) => onGame(event.target.value)}
        />
      </label>
      <label>
        相关词汇
        <textarea
          value={terms}
          maxLength={350}
          disabled={disabled}
          onChange={(event) => onTerms(event.target.value)}
          placeholder="用逗号分隔，最多 16 个"
        />
      </label>
    </details>
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
