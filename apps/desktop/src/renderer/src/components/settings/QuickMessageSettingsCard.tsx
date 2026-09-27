import { useMemo, useState, useSyncExternalStore, type CSSProperties, type DragEvent } from "react";
import { Download, GripVertical, Headphones, Music2, Search, Volume2, Zap } from "lucide-react";

import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  QUICK_MESSAGE_PRESETS,
  normalizeQuickMessageSlots,
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
  const slots: QuickMessageShortcutSlot[] = normalizeQuickMessageSlots(
    settings.quickMessages.slots,
    DEFAULT_QUICK_MESSAGE_SLOTS,
    DEFAULT_QUICK_MESSAGE_SLOTS.length,
  );
  const musicSlots: QuickMessageShortcutSlot[] = normalizeQuickMessageSlots(
    settings.quickMessages.musicSlots?.length
      ? settings.quickMessages.musicSlots
      : settings.quickMessages.musicPresetId
        ? [
            {
              ...DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[0],
              presetId: settings.quickMessages.musicPresetId,
            },
          ]
        : settings.quickMessages.musicSlots,
    DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
    DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length,
  );
  const [dragOverSlot, setDragOverSlot] = useState<string>();
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryMediaFilter, setLibraryMediaFilter] = useState<LibraryMediaFilter>("全部");
  const [libraryGameFilter, setLibraryGameFilter] = useState("");
  const [libraryStreamerFilter, setLibraryStreamerFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"library" | "shortcuts">("library");
  const audioSnapshot = useSyncExternalStore(
    subscribeQuickMessageAudio,
    getQuickMessageAudioSnapshot,
    getQuickMessageAudioSnapshot,
  );
  const musicPresets = useMemo(
    () => QUICK_MESSAGE_PRESETS.filter((preset) => preset.mediaType === "music"),
    [],
  );
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
    updateSlot(index, { presetId, enabled: Boolean(slots[index]?.shortcut) });
  };

  const handleSlotDrop = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const presetId = event.dataTransfer.getData("text/plain");
    if (
      QUICK_MESSAGE_PRESETS.some((preset) => preset.id === presetId && preset.mediaType !== "music")
    ) {
      replaceSlotPreset(index, presetId);
    }
    setDragOverSlot(undefined);
  };

  const handleMusicDrop = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const presetId = event.dataTransfer.getData("text/plain");
    const preset = QUICK_MESSAGE_PRESETS.find((candidate) => candidate.id === presetId);
    if (preset?.mediaType === "music") {
      updateMusicSlot(index, {
        presetId: preset.id,
        enabled: Boolean(musicSlots[index]?.shortcut),
      });
    }
    setDragOverSlot(undefined);
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

  const libraryControls = (
    <div className="quick-message-library-controls">
      <label className="quick-message-library-sound-toggle">
        <span>播放音频</span>
        <Switch
          ariaLabel="播放快捷消息音频"
          isChecked={settings.quickMessages.soundEnabled}
          onChange={(soundEnabled) =>
            onChange({ quickMessages: { ...settings.quickMessages, soundEnabled } })
          }
        />
      </label>
      <label className="quick-message-library-volume">
        <Volume2 aria-hidden="true" />
        <span>音量</span>
        <input
          className="ui-sound-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.quickMessages.soundVolume}
          aria-label="快捷消息音量"
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
        <output>{Math.round(settings.quickMessages.soundVolume * 100)}%</output>
      </label>
    </div>
  );

  return (
    <div className="space-y-3">
      <nav className="quick-message-settings-tabs" aria-label="快捷消息设置">
        {(
          [
            ["library", "我的快捷消息"],
            ["shortcuts", "快捷键"],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-current={activeTab === tab ? "page" : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>
      {activeTab === "library" ? (
        <SettingsSection title="我的快捷消息" headerAction={libraryControls}>
          <div className="quick-message-slot-groups">
            <div className="quick-message-slot-group">
              <div className="quick-message-slot-group-heading">
                <strong>语音 / 音效</strong>
                <span>拖到槽位即可绑定</span>
              </div>
              <div className="quick-message-slot-list quick-message-slot-list--voice">
                {slots.map((slot, index) => {
                  const preset = QUICK_MESSAGE_PRESETS.find(
                    (candidate) => candidate.id === slot.presetId,
                  );
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`quick-message-slot ${dragOverSlot === `voice-${index}` ? "is-drag-over" : ""}`}
                      aria-label={`语音槽位 ${index + 1}：${preset?.label ?? "未绑定"}；点击试听或拖入音频替换`}
                      title="点击试听；从下方拖入语音或音效替换"
                      onClick={() => preset && previewPreset(preset)}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setDragOverSlot(`voice-${index}`);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDragLeave={() => setDragOverSlot(undefined)}
                      onDrop={(event) => handleSlotDrop(event, index)}
                    >
                      <span className="quick-message-slot-number">{index + 1}</span>
                      <span className="quick-message-slot-name">{preset?.label ?? "未绑定"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="quick-message-slot-group quick-message-slot-group--music">
              <div className="quick-message-slot-group-heading">
                <strong>
                  <Music2 aria-hidden="true" /> 音乐
                </strong>
                <span>拖到槽位即可绑定</span>
              </div>
              <div className="quick-message-slot-list quick-message-slot-list--music">
                {musicSlots.map((slot, index) => {
                  const preset = musicPresets.find((candidate) => candidate.id === slot.presetId);
                  return (
                    <button
                      key={index}
                      type="button"
                      className={`quick-message-slot ${dragOverSlot === `music-${index}` ? "is-drag-over" : ""}`}
                      aria-label={`音乐槽位 ${index + 1}：${preset?.label ?? "未绑定"}；点击试听或拖入音乐替换`}
                      title="点击试听；从下方拖入音乐替换"
                      onClick={() => preset && previewPreset(preset)}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setDragOverSlot(`music-${index}`);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDragLeave={() => setDragOverSlot(undefined)}
                      onDrop={(event) => handleMusicDrop(event, index)}
                    >
                      <span className="quick-message-slot-number">{index + 1}</span>
                      <span className="quick-message-slot-name">{preset?.label ?? "未绑定"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
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
          <div className="flex flex-wrap gap-1.5">
            {visiblePresets.map((preset) => {
              const assignedSlots = assignedSlotsByPreset.get(preset.id) ?? [];
              const assignedMusicSlots = assignedMusicSlotsByPreset.get(preset.id) ?? [];
              const isAssigned = assignedSlots.length > 0 || assignedMusicSlots.length > 0;
              const assignedLabel = [
                ...assignedSlots.map((index) => `语音 ${index}`),
                ...assignedMusicSlots.map((index) => `音乐 ${index}`),
              ].join(" · ");
              return (
                <div
                  key={preset.id}
                  draggable
                  className={`group relative w-fit max-w-full cursor-grab rounded-[9px] border px-2 py-1 transition-[border-color,background-color,box-shadow] duration-150 active:cursor-grabbing ${
                    preset.mediaType === "music" ? "quick-message-music-card" : ""
                  } ${
                    isAssigned
                      ? "border-[#86BDF4] bg-[#F1F8FF] shadow-[0_5px_16px_rgba(77,155,243,.11)]"
                      : "border-[#E4EBF2] bg-white hover:border-[#B9D7F5] hover:bg-[#FBFDFF]"
                  }`}
                  aria-label={`拖动${preset.mediaType === "music" ? "音乐" : "语音"} ${formatPresetName(preset)} 到上方槽位`}
                  title={getPresetTags(preset).join(" · ") || "未分类"}
                  onDragStart={(event) => handlePresetDragStart(event, preset)}
                  onDragEnd={() => setDragOverSlot(undefined)}
                >
                  <div className="flex min-h-7 items-center gap-1.5">
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#A4B8CD]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="whitespace-nowrap text-[13px] font-semibold text-[#344054]">
                          {formatPresetName(preset)}
                        </span>
                        {preset.mediaType === "music" ? (
                          <Music2
                            className="quick-message-music-icon h-3.5 w-3.5"
                            aria-label="音乐"
                          />
                        ) : null}
                      </div>
                      {isAssigned ? (
                        <span className="block text-[10px] font-medium leading-[1.2] text-[#3987DF]">
                          已添加 · {assignedLabel}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#E1EAF3] bg-white text-[#6B8EAF] transition-colors hover:border-[#A8CFF5] hover:text-[#3987DF] ${preset.mediaType === "music" ? "quick-message-music-preview-control" : ""}`}
                      aria-label={`试听${preset.label}`}
                      disabled={!settings.quickMessages.soundEnabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        previewPreset(preset);
                      }}
                    >
                      <Headphones className="h-3 w-3" />
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
      ) : null}

      {activeTab === "shortcuts" ? (
        <SettingsSection
          title="快捷键"
          description="这里的开关只控制全局快捷键；房间里的鼠标点击按钮始终保留。"
        >
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
                      onChange={(shortcut) =>
                        updateSlot(index, {
                          shortcut,
                          enabled: shortcut ? (slot.shortcut ? slot.enabled : true) : false,
                        })
                      }
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
                        onChange={(event) =>
                          updateMusicSlot(index, { presetId: event.target.value })
                        }
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
                        onChange={(shortcut) =>
                          updateMusicSlot(index, {
                            shortcut,
                            enabled: shortcut ? (slot.shortcut ? slot.enabled : true) : false,
                          })
                        }
                        defaultValue={DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[index]?.shortcut ?? ""}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
};
