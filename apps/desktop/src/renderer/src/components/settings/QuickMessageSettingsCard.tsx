import { useMemo, useState, useSyncExternalStore, type CSSProperties, type DragEvent } from "react";
import {
  Check,
  Download,
  GripVertical,
  Headphones,
  Music2,
  Pause,
  Search,
  SlidersHorizontal,
  Volume2,
  Zap,
} from "lucide-react";

import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  QUICK_MESSAGE_PRESETS,
  type AppSettings,
  type QuickMessagePreset,
  type QuickMessageShortcutSlot,
} from "@private-voice/shared";

import { ShortcutInput } from "../base/ShortcutInput";
import { Button } from "../base/Button";
import { Switch } from "../base/Switch";
import { SettingsSection } from "./SettingsSection";
import {
  getQuickMessageAudioSnapshot,
  playQuickMessageSound,
  subscribeQuickMessageAudio,
  toggleQuickMessageMusic,
} from "../../features/audio/quickMessageAudio";

const SLOT_COUNT = 5;
const LIBRARY_MEDIA_FILTERS = ["全部", "语音", "音乐", "默认", "未分类"] as const;
type LibraryMediaFilter = (typeof LIBRARY_MEDIA_FILTERS)[number];

const formatPresetName = (preset: QuickMessagePreset) => preset.label.trim() || preset.content;

const libraryPresetCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

const compareLibraryPresets = (left: QuickMessagePreset, right: QuickMessagePreset): number => {
  // Keep the library visually grouped: voice effects first, music below them.
  const leftMediaRank = left.mediaType === "music" ? 1 : 0;
  const rightMediaRank = right.mediaType === "music" ? 1 : 0;
  return (
    leftMediaRank - rightMediaRank ||
    libraryPresetCollator.compare(formatPresetName(left), formatPresetName(right)) ||
    left.id.localeCompare(right.id)
  );
};

const matchesLibraryMediaFilter = (
  preset: QuickMessagePreset,
  filter: LibraryMediaFilter,
): boolean => {
  if (filter === "全部") return true;
  if (filter === "语音") return preset.mediaType !== "music";
  if (filter === "音乐") return preset.mediaType === "music";
  if (filter === "默认") return preset.category === "默认语音";
  return preset.category === "未分类" && !preset.streamer && (preset.gameTags?.length ?? 0) === 0;
};

const getPresetTags = (preset: QuickMessagePreset): string[] => [
  ...(preset.mediaType === "music" ? ["音乐"] : ["语音"]),
  ...(preset.tags ?? []),
  ...(preset.streamer ? [`主播：${preset.streamer}`] : []),
  ...(preset.gameTags ?? []).map((game) => `游戏：${game}`),
];

export const QuickMessageSettingsCard = ({
  settings,
  onChange,
  onExport,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onExport: () => Promise<void>;
}) => {
  const slots: QuickMessageShortcutSlot[] = Array.from(
    { length: SLOT_COUNT },
    (_, index) =>
      settings.quickMessages.slots[index] ??
      DEFAULT_QUICK_MESSAGE_SLOTS[index] ?? { presetId: undefined, shortcut: "", enabled: false },
  );
  const musicSlots: QuickMessageShortcutSlot[] = Array.from(
    { length: DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length },
    (_, index) => {
      const fallback = DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[index] ?? {
        presetId: undefined,
        shortcut: "",
        enabled: false,
      };
      const savedSlot = settings.quickMessages.musicSlots?.[index];
      if (savedSlot) return savedSlot;
      return index === 0 && settings.quickMessages.musicPresetId
        ? { ...fallback, presetId: settings.quickMessages.musicPresetId }
        : fallback;
    },
  );
  const [selectedPresetId, setSelectedPresetId] = useState(
    slots[0]?.presetId ?? QUICK_MESSAGE_PRESETS[0]?.id ?? "",
  );
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number>();
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryMediaFilter, setLibraryMediaFilter] = useState<LibraryMediaFilter>("全部");
  const [libraryGameFilter, setLibraryGameFilter] = useState("");
  const [libraryStreamerFilter, setLibraryStreamerFilter] = useState("");
  const audioSnapshot = useSyncExternalStore(
    subscribeQuickMessageAudio,
    getQuickMessageAudioSnapshot,
    getQuickMessageAudioSnapshot,
  );
  const musicPresets = useMemo(
    () => QUICK_MESSAGE_PRESETS.filter((preset) => preset.mediaType === "music"),
    [],
  );
  const selectedMusicSlots = musicSlots.map((slot, index) => ({
    slot,
    preset:
      musicPresets.find((preset) => preset.id === slot.presetId) ??
      (index === 0
        ? musicPresets.find((preset) => preset.id === settings.quickMessages.musicPresetId)
        : undefined) ??
      musicPresets[index] ??
      musicPresets[0],
  }));

  const libraryGameOptions = useMemo(
    () =>
      Array.from(new Set(QUICK_MESSAGE_PRESETS.flatMap((preset) => preset.gameTags ?? []))).sort(
        (left, right) => left.localeCompare(right, "zh-CN"),
      ),
    [],
  );
  const libraryStreamerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          QUICK_MESSAGE_PRESETS.map((preset) => preset.streamer).filter(
            (streamer): streamer is string => Boolean(streamer),
          ),
        ),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [],
  );

  const visiblePresets = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("zh-CN");
    return QUICK_MESSAGE_PRESETS.filter((preset) => {
      const matchesGame = !libraryGameFilter || (preset.gameTags ?? []).includes(libraryGameFilter);
      const matchesStreamer = !libraryStreamerFilter || preset.streamer === libraryStreamerFilter;
      const matchesMedia = matchesLibraryMediaFilter(preset, libraryMediaFilter);
      const searchableText = [
        preset.label,
        preset.content,
        preset.category,
        preset.streamer ?? "",
        ...(preset.gameTags ?? []),
        ...(preset.tags ?? []),
        preset.mediaType === "music" ? "音乐" : "语音",
      ];
      const matchesQuery =
        !query || searchableText.some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
      return matchesGame && matchesStreamer && matchesMedia && matchesQuery;
    }).sort(compareLibraryPresets);
  }, [libraryGameFilter, libraryMediaFilter, libraryQuery, libraryStreamerFilter]);

  const assignedSlotsByPreset = useMemo(() => {
    const assignments = new Map<string, number[]>();
    slots.forEach((slot, index) => {
      if (!slot.presetId) return;
      const presetSlots = assignments.get(slot.presetId) ?? [];
      presetSlots.push(index + 1);
      assignments.set(slot.presetId, presetSlots);
    });
    return assignments;
  }, [slots]);
  const assignedMusicSlotsByPreset = useMemo(() => {
    const assignments = new Map<string, number[]>();
    musicSlots.forEach((slot, index) => {
      if (!slot.presetId) return;
      const presetSlots = assignments.get(slot.presetId) ?? [];
      presetSlots.push(index + 1);
      assignments.set(slot.presetId, presetSlots);
    });
    return assignments;
  }, [musicSlots]);

  const updateSlots = (nextSlots: QuickMessageShortcutSlot[]) => {
    onChange({
      quickMessages: {
        ...settings.quickMessages,
        slots: nextSlots,
      },
    });
  };

  const updateSlot = (index: number, patch: Partial<QuickMessageShortcutSlot>) => {
    updateSlots(
      slots.map((slot, slotIndex) => (slotIndex === index ? { ...slot, ...patch } : slot)),
    );
  };

  const updateMusicSlot = (index: number, patch: Partial<QuickMessageShortcutSlot>) => {
    onChange({
      quickMessages: {
        ...settings.quickMessages,
        ...(index === 0 && patch.presetId ? { musicPresetId: patch.presetId } : {}),
        musicSlots: musicSlots.map((slot, slotIndex) =>
          slotIndex === index ? { ...slot, ...patch } : slot,
        ),
      },
    });
  };

  const replaceSlotPreset = (index: number, presetId: string) => {
    setSelectedPresetId(presetId);
    updateSlot(index, { presetId, enabled: true });
  };

  const handleSlotDrop = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const presetId = event.dataTransfer.getData("text/plain");
    if (QUICK_MESSAGE_PRESETS.some((preset) => preset.id === presetId)) {
      replaceSlotPreset(index, presetId);
    }
    setDragOverSlotIndex(undefined);
  };

  const handleMusicDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const presetId = event.dataTransfer.getData("text/plain");
    const preset = QUICK_MESSAGE_PRESETS.find((candidate) => candidate.id === presetId);
    if (preset?.mediaType === "music") {
      updateMusicSlot(index, { presetId: preset.id, enabled: true });
    }
  };

  const handlePresetDragStart = (event: DragEvent<HTMLDivElement>, preset: QuickMessagePreset) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", preset.id);
  };

  const playPreset = (preset: QuickMessagePreset) => {
    if (!settings.quickMessages.soundEnabled) return;
    playQuickMessageSound(
      preset.soundId,
      settings.avatarId,
      settings.quickMessages.soundVolume,
      preset.content,
      preset.mediaType,
    );
  };

  const previewPreset = (preset: QuickMessagePreset) => {
    if (
      preset.mediaType === "music" &&
      audioSnapshot.soundId === preset.soundId &&
      (audioSnapshot.status === "playing" || audioSnapshot.status === "paused")
    ) {
      toggleQuickMessageMusic(preset.soundId);
      return;
    }
    playPreset(preset);
  };

  return (
    <div className="space-y-3">
      <SettingsSection title="快捷消息">
        <div>
          <div className="quick-message-preview rounded-[18px] border border-[#C8DDF6] bg-[linear-gradient(145deg,#F7FBFF_0%,#EEF6FF_100%)] p-3 shadow-[0_8px_24px_rgba(76,132,190,.08)]">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-white text-[#4D9BF3] shadow-sm">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[#243B5A]">实时预览</div>
                  <div className="text-[11px] text-[#7890AD]">
                    点击语音直接试听；拖入语音包可替换槽位
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/90 bg-white/70 px-2 py-1">
                <span className="text-[11px] text-[#7890AD]">开关音效</span>
                <Switch
                  isChecked={settings.quickMessages.soundEnabled}
                  onChange={(soundEnabled) =>
                    onChange({
                      quickMessages: { ...settings.quickMessages, soundEnabled },
                    })
                  }
                />
              </div>
            </div>

            <div
              className="grid grid-cols-5 gap-2"
              aria-label="点击快捷消息试听，拖入语音包可替换对应槽位"
            >
              {slots.map((slot, index) => {
                const preset = QUICK_MESSAGE_PRESETS.find(
                  (candidate) => candidate.id === slot.presetId,
                );
                const isDragTarget = dragOverSlotIndex === index;
                return (
                  <button
                    key={index}
                    type="button"
                    className={`relative min-h-9 min-w-0 cursor-pointer truncate rounded-[10px] border px-2.5 text-xs transition-[border-color,background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4D9BF3]/50 ${
                      isDragTarget
                        ? "border-[#4D9BF3] bg-[#E7F3FF] font-semibold text-[#2F7FD8] shadow-[0_0_0_3px_rgba(77,155,243,.16)]"
                        : preset
                          ? "border-[#D7E6F6] bg-white text-[#66809E] hover:border-[#A8CFF5] hover:bg-[#F5FAFF]"
                          : "border-dashed border-[#C8DDF6] bg-white/70 text-[#91A4B8] hover:border-[#8EBFF0]"
                    }`}
                    aria-label={
                      preset
                        ? `试听${preset.label}；拖入语音包可替换槽位 ${index + 1}`
                        : `槽位 ${index + 1} 暂无语音；拖入语音包可替换`
                    }
                    title={
                      preset
                        ? `点击试听；拖入语音包可替换槽位 ${index + 1}`
                        : `拖入语音包可替换槽位 ${index + 1}`
                    }
                    onClick={() => {
                      if (preset) previewPreset(preset);
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragOverSlotIndex(index);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                      setDragOverSlotIndex(index);
                    }}
                    onDragLeave={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (
                        !(nextTarget instanceof Node) ||
                        !event.currentTarget.contains(nextTarget)
                      ) {
                        setDragOverSlotIndex(undefined);
                      }
                    }}
                    onDrop={(event) => handleSlotDrop(event, index)}
                  >
                    <span className="relative z-[1] block truncate">
                      {preset?.mediaType === "music" ? (
                        audioSnapshot.soundId === preset.soundId &&
                        audioSnapshot.status === "playing" ? (
                          <Pause className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        ) : (
                          <Music2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        )
                      ) : null}
                      {preset?.content ?? `槽位 ${index + 1}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="quick-message-music-preview mt-2 min-w-0 rounded-[12px] border px-2 py-1.5">
              <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#287F99]">
                <Music2 className="quick-message-music-icon h-3.5 w-3.5" aria-hidden="true" />
                音乐（可添加 3 首）
              </div>
              <div className="quick-message-music-preview-list mt-1.5">
                {selectedMusicSlots.map(({ preset }, index) =>
                  preset ? (
                    <div
                      key={index}
                      className="quick-message-music-preview-item"
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(event) => handleMusicDrop(event, index)}
                    >
                      <button
                        type="button"
                        className="quick-message-music-button interactive-surface inline-flex min-w-0 items-center gap-1.5 rounded-[9px] border bg-white px-2.5 py-1.5 text-left text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label={`试听音乐 ${preset.label}`}
                        title={`点击试听；也可以把音乐拖到第 ${index + 1} 个位置替换`}
                        disabled={!settings.quickMessages.soundEnabled}
                        onClick={() => previewPreset(preset)}
                      >
                        {audioSnapshot.soundId === preset.soundId &&
                        audioSnapshot.status === "playing" ? (
                          <Pause
                            className="quick-message-music-icon h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <Music2
                            className="quick-message-music-icon h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate">{preset.label}</span>
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-end gap-2">
              <Volume2 className="h-4 w-4 shrink-0 text-[#6A8BAF]" />
              <input
                className="ui-sound-volume min-w-0 max-w-[180px] flex-1"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.quickMessages.soundVolume}
                aria-label="快捷语音音量"
                disabled={!settings.quickMessages.soundEnabled}
                style={
                  {
                    "--ui-sound-volume": `${settings.quickMessages.soundVolume * 100}%`,
                  } as CSSProperties
                }
                onChange={(event) =>
                  onChange({
                    quickMessages: {
                      ...settings.quickMessages,
                      soundVolume: Number(event.target.value),
                    },
                  })
                }
              />
              <span className="w-10 text-right text-xs tabular-nums text-[#66809E]">
                {Math.round(settings.quickMessages.soundVolume * 100)}%
              </span>
              <span className="hidden text-[11px] text-[#91A4B8] sm:inline">略低于人声</span>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="快捷音频库">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="relative min-w-[220px] max-w-[360px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8CA2B8]" />
            <input
              type="search"
              className="h-9 w-full rounded-[10px] border border-[#DCE7F2] bg-white pl-9 pr-3 text-xs text-[#344054] outline-none transition-colors placeholder:text-[#9AAFC3] focus:border-[#7DB8F2] focus:ring-2 focus:ring-[#4D9BF3]/15"
              value={libraryQuery}
              placeholder="搜索音频名称或标签"
              aria-label="搜索语音包"
              onChange={(event) => setLibraryQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className="flex h-9 items-center gap-0.5 rounded-[10px] border border-[#DCE7F2] bg-white p-0.5"
              aria-label="筛选音频类型"
            >
              {LIBRARY_MEDIA_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`h-8 rounded-[8px] px-2.5 text-xs transition-colors ${
                    libraryMediaFilter === filter
                      ? "bg-[#E7F3FF] font-semibold text-[#3987DF]"
                      : "text-[#7890AD] hover:bg-[#F5FAFF]"
                  }`}
                  aria-pressed={libraryMediaFilter === filter}
                  onClick={() => setLibraryMediaFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-[#6F849A]">
              游戏
              <select
                className="quick-message-filter-select settings-inline-select h-9 text-xs"
                value={libraryGameFilter}
                aria-label="按游戏筛选音频"
                onChange={(event) => setLibraryGameFilter(event.target.value)}
              >
                <option value="">全部游戏</option>
                {libraryGameOptions.map((game) => (
                  <option key={game} value={game}>
                    {game}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-[#6F849A]">
              主播
              <select
                className="quick-message-filter-select settings-inline-select h-9 text-xs"
                value={libraryStreamerFilter}
                aria-label="按主播筛选音频"
                onChange={(event) => setLibraryStreamerFilter(event.target.value)}
              >
                <option value="">全部主播</option>
                {libraryStreamerOptions.map((streamer) => (
                  <option key={streamer} value={streamer}>
                    {streamer}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              className="h-9 gap-1.5 px-3 text-xs"
              onClick={() => void onExport()}
            >
              <Download className="h-3.5 w-3.5" />
              导出音频包
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {visiblePresets.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            const assignedSlots = assignedSlotsByPreset.get(preset.id) ?? [];
            const assignedMusicSlots = assignedMusicSlotsByPreset.get(preset.id) ?? [];
            const isAssigned = assignedSlots.length > 0 || assignedMusicSlots.length > 0;
            return (
              <div
                key={preset.id}
                draggable
                className={`group relative w-fit max-w-full cursor-grab rounded-[12px] border px-2.5 py-2 transition-[border-color,background-color,box-shadow] duration-150 active:cursor-grabbing ${
                  preset.mediaType === "music" ? "quick-message-music-card" : ""
                } ${
                  isSelected || isAssigned
                    ? "border-[#86BDF4] bg-[#F1F8FF] shadow-[0_5px_16px_rgba(77,155,243,.11)]"
                    : "border-[#E4EBF2] bg-white hover:border-[#B9D7F5] hover:bg-[#FBFDFF]"
                }`}
                aria-label={`选择${preset.mediaType === "music" ? "音乐" : "语音"} ${formatPresetName(preset)}`}
                title={getPresetTags(preset).join(" · ") || "未分类"}
                onClick={() => setSelectedPresetId(preset.id)}
                onDragStart={(event) => handlePresetDragStart(event, preset)}
                onDragEnd={() => setDragOverSlotIndex(undefined)}
              >
                <div className="flex min-h-8 items-center gap-2">
                  <GripVertical className="h-4 w-4 shrink-0 text-[#A4B8CD]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap text-sm font-semibold text-[#344054]">
                        {formatPresetName(preset)}
                      </span>
                      {preset.mediaType === "music" ? (
                        <Music2
                          className="quick-message-music-icon h-3.5 w-3.5"
                          aria-label="音乐"
                        />
                      ) : null}
                      {isSelected ? <Check className="h-3.5 w-3.5 text-[#3987DF]" /> : null}
                    </div>
                    {isAssigned ? (
                      <span className="mt-0.5 block text-[10px] font-medium text-[#3987DF]">
                        {preset.mediaType === "music" ? (
                          `已添加 · 音乐 ${assignedMusicSlots.join("、")}`
                        ) : (
                          <>已添加 · 槽位 {assignedSlots.join("、")}</>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[#E1EAF3] bg-white text-[#6B8EAF] transition-colors hover:border-[#A8CFF5] hover:text-[#3987DF] ${preset.mediaType === "music" ? "quick-message-music-preview-control" : ""}`}
                    aria-label={`试听${preset.label}`}
                    disabled={!settings.quickMessages.soundEnabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      previewPreset(preset);
                    }}
                  >
                    <Headphones className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          {visiblePresets.length === 0 ? (
            <div className="flex min-h-20 w-full items-center justify-center rounded-[12px] border border-dashed border-[#D7E3EF] text-xs text-[#8298AE]">
              {libraryMediaFilter === "音乐"
                ? "还没有音乐片段；之后登记音乐后会保留原歌名。"
                : "没有找到匹配的音频"}
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="快捷键">
        <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-5">
          {slots.map((slot, index) => {
            const preset = QUICK_MESSAGE_PRESETS.find(
              (candidate) => candidate.id === slot.presetId,
            );
            return (
              <div
                key={index}
                className="rounded-[11px] border border-[#E5EBF2] bg-[#FBFCFD] p-2 transition-colors"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#516B87]">
                    <Zap className="h-3.5 w-3.5 text-[#4D9BF3]" />
                    槽位 {index + 1}
                    {preset ? (
                      <span className="truncate font-normal text-[#8AA0B7]">
                        · {preset.content}
                      </span>
                    ) : null}
                  </div>
                  <Switch
                    isChecked={slot.enabled}
                    onChange={(enabled) => updateSlot(index, { enabled })}
                  />
                </div>
                <div>
                  <ShortcutInput
                    compact
                    value={slot.shortcut}
                    onChange={(shortcut) => updateSlot(index, { shortcut })}
                    defaultValue={DEFAULT_QUICK_MESSAGE_SLOTS[index]?.shortcut ?? ""}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 border-t border-[#E7EEF5] pt-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#287F99]">
            <Music2 className="quick-message-music-icon h-3.5 w-3.5" aria-hidden="true" />
            音乐快捷键
            <span className="font-normal text-[#8AA0B7]">支持键盘组合键和鼠标侧键</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {musicSlots.map((slot, index) => {
              const preset = musicPresets.find((candidate) => candidate.id === slot.presetId);
              return (
                <div
                  key={index}
                  className="quick-message-music-shortcut rounded-[11px] border p-2 transition-colors"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#287F99]">
                      <Music2 className="quick-message-music-icon h-3.5 w-3.5" />
                      音乐 {index + 1}
                      <span className="truncate font-normal text-[#8AA0B7]">
                        · {preset?.label ?? "未选择"}
                      </span>
                    </div>
                    <Switch
                      isChecked={slot.enabled}
                      onChange={(enabled) => updateMusicSlot(index, { enabled })}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                    <select
                      className="quick-message-music-select settings-inline-select h-9 min-w-0 text-xs"
                      value={slot.presetId ?? ""}
                      aria-label={`选择音乐快捷键 ${index + 1} 的音乐`}
                      disabled={!slot.enabled || !settings.quickMessages.soundEnabled}
                      onChange={(event) => updateMusicSlot(index, { presetId: event.target.value })}
                    >
                      <option value="">选择音乐</option>
                      {musicPresets.map((musicPreset) => (
                        <option key={musicPreset.id} value={musicPreset.id}>
                          {musicPreset.label}
                        </option>
                      ))}
                    </select>
                    <ShortcutInput
                      compact
                      value={slot.shortcut}
                      onChange={(shortcut) => updateMusicSlot(index, { shortcut })}
                      defaultValue={DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[index]?.shortcut ?? ""}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
};
