import type { AppSettings } from "@private-voice/shared";

export function AsrGameLexiconSettings({
  settings,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
}) {
  const entries = settings.aiAsrGameLexicon ?? [];
  return (
    <section className="ai-model-group mt-3" aria-labelledby="asr-game-lexicon-title">
      <div className="ai-model-group-heading">
        <h3 id="asr-game-lexicon-title">游戏词汇</h3>
      </div>
      <p className="mt-2 text-sm text-[#718096]">
        已按房间成员正在玩的游戏自动匹配常见名称和术语；以前保存的 {entries.length}{" "}
        组个人词条仍会自动补充，无需手动维护。
      </p>
    </section>
  );
}
