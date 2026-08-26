import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import {
  Check,
  Download,
  GripVertical,
  Headphones,
  Search,
  SlidersHorizontal,
  Volume2,
  Zap,
} from "lucide-react";

import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  QUICK_MESSAGE_PRESETS,
  type AppSettings,
  type QuickMessagePreset,
  type QuickMessageShortcutSlot,
} from "@private-voice/shared";

import { ShortcutInput } from "../base/ShortcutInput";
import { Button } from "../base/Button";
import { Switch } from "../base/Switch";
import { SettingsSection } from "./SettingsSection";
import { playQuickMessageSound } from "../../features/audio/quickMessageAudio";
import { LiquidSelectionIndicator } from "../motion/LiquidSelectionIndicator";

const SLOT_COUNT = 5;
const LIBRARY_FILTERS = ["全部", "游戏", "主播", "默认语音", "未分类"] as const;
type LibraryFilter = (typeof LIBRARY_FILTERS)[number];
type LibrarySelection = "全部" | "默认语音" | "未分类" | `game:${string}` | `streamer:${string}`;

const formatPresetName = (preset: QuickMessagePreset) =>
  preset.label.trim() === preset.content.trim()
    ? preset.content
    : `${preset.label} · ${preset.content}`;

const matchesLibraryFilter = (preset: QuickMessagePreset, filter: LibraryFilter): boolean => {
  if (filter === "全部") return true;
  if (filter === "游戏") return (preset.gameTags?.length ?? 0) > 0;
  if (filter === "主播") return Boolean(preset.streamer);
  if (filter === "默认语音") return preset.category === "默认语音";
  return preset.category === "未分类" && !preset.streamer && (preset.gameTags?.length ?? 0) === 0;
};

const getPresetTags = (preset: QuickMessagePreset): string[] => [
  ...(preset.streamer ? [`主播：${preset.streamer}`] : []),
  ...(preset.gameTags ?? []).map((game) => `游戏：${game}`),
];

const parseLibrarySelection = (
  selection: LibrarySelection,
): {
  filter: LibraryFilter;
  subfilter: string;
} => {
  if (selection.startsWith("game:")) {
    return { filter: "游戏", subfilter: selection.slice("game:".length) };
  }
  if (selection.startsWith("streamer:")) {
    return { filter: "主播", subfilter: selection.slice("streamer:".length) };
  }
  if (selection === "全部" || selection === "默认语音" || selection === "未分类") {
    return { filter: selection, subfilter: "" };
  }
  return { filter: "全部", subfilter: "" };
};

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
  const [selectedPresetId, setSelectedPresetId] = useState(
    slots[0]?.presetId ?? QUICK_MESSAGE_PRESETS[0]?.id ?? "",
  );
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number>();
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySelection, setLibrarySelection] = useState<LibrarySelection>("全部");
  const { filter: libraryFilter, subfilter: librarySubfilter } =
    parseLibrarySelection(librarySelection);

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
      const matchesFilter =
        matchesLibraryFilter(preset, libraryFilter) &&
        (libraryFilter === "游戏"
          ? !librarySubfilter || (preset.gameTags ?? []).includes(librarySubfilter)
          : libraryFilter === "主播"
            ? !librarySubfilter || preset.streamer === librarySubfilter
            : true);
      const searchableText = [
        preset.label,
        preset.content,
        preset.category,
        preset.streamer ?? "",
        ...(preset.gameTags ?? []),
      ];
      const matchesQuery =
        !query || searchableText.some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
      return matchesFilter && matchesQuery;
    });
  }, [libraryFilter, libraryQuery, librarySubfilter]);

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

  const replaceSlotPreset = (index: number, presetId: string) => {
    setSelectedSlotIndex(index);
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
    );
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
                  <div className="text-[11px] text-[#7890AD]">把语音包拖到任意快捷按钮即可替换</div>
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

            <div className="grid grid-cols-5 gap-2" aria-label="把语音包拖到对应快捷按钮即可替换">
              {slots.map((slot, index) => {
                const preset = QUICK_MESSAGE_PRESETS.find(
                  (candidate) => candidate.id === slot.presetId,
                );
                const isDragTarget = dragOverSlotIndex === index;
                return (
                  <button
                    key={index}
                    type="button"
                    className={`relative min-h-9 min-w-0 cursor-copy truncate rounded-[10px] border px-2.5 text-xs transition-[border-color,background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4D9BF3]/50 ${
                      isDragTarget
                        ? "border-[#4D9BF3] bg-[#E7F3FF] font-semibold text-[#2F7FD8] shadow-[0_0_0_3px_rgba(77,155,243,.16)]"
                        : preset
                          ? "border-[#D7E6F6] bg-white text-[#66809E] hover:border-[#A8CFF5] hover:bg-[#F5FAFF]"
                          : "border-dashed border-[#C8DDF6] bg-white/70 text-[#91A4B8] hover:border-[#8EBFF0]"
                    }`}
                    aria-label={`用当前选择的语音包替换槽位 ${index + 1}`}
                    title={`点击或拖入语音包替换槽位 ${index + 1}`}
                    onClick={() => {
                      if (selectedPresetId) replaceSlotPreset(index, selectedPresetId);
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
                    {selectedSlotIndex === index ? (
                      <LiquidSelectionIndicator
                        layoutId="quick-message-slot-selection"
                        className="inset-[2px] bg-[#F7FBFF] shadow-[0_3px_10px_rgba(63,111,180,.08),inset_0_0_0_1px_rgba(151,192,239,.28)]"
                      />
                    ) : null}
                    <span className="relative z-[1] block truncate">
                      {preset?.content ?? `槽位 ${index + 1}`}
                    </span>
                  </button>
                );
              })}
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

      <SettingsSection title="语音包库">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="relative min-w-[220px] max-w-[360px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8CA2B8]" />
            <input
              type="search"
              className="h-9 w-full rounded-[10px] border border-[#DCE7F2] bg-white pl-9 pr-3 text-xs text-[#344054] outline-none transition-colors placeholder:text-[#9AAFC3] focus:border-[#7DB8F2] focus:ring-2 focus:ring-[#4D9BF3]/15"
              value={libraryQuery}
              placeholder="搜索语音或分类"
              aria-label="搜索语音包"
              onChange={(event) => setLibraryQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-[#6F849A]">
              分类
              <select
                className="settings-inline-select h-9 min-w-[196px] text-xs"
                value={librarySelection}
                aria-label="筛选语音包分类"
                onChange={(event) => setLibrarySelection(event.target.value as LibrarySelection)}
              >
                {LIBRARY_FILTERS.filter((filter) => filter !== "游戏" && filter !== "主播").map(
                  (filter) => (
                    <option key={filter} value={filter}>
                      {filter === "全部" ? "全部语音" : filter}
                    </option>
                  ),
                )}
                <optgroup label="游戏">
                  <option value="game:">全部游戏</option>
                  {libraryGameOptions.map((game) => (
                    <option key={game} value={`game:${game}`}>
                      {game}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="主播">
                  <option value="streamer:">全部主播</option>
                  {libraryStreamerOptions.map((streamer) => (
                    <option key={streamer} value={`streamer:${streamer}`}>
                      {streamer}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <Button
              variant="secondary"
              className="h-9 gap-1.5 px-3 text-xs"
              onClick={() => void onExport()}
            >
              <Download className="h-3.5 w-3.5" />
              导出语音包
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {visiblePresets.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            const assignedSlots = assignedSlotsByPreset.get(preset.id) ?? [];
            const isAssigned = assignedSlots.length > 0;
            return (
              <div
                key={preset.id}
                draggable
                className={`group relative w-fit max-w-full cursor-grab rounded-[12px] border px-2.5 py-2 transition-[border-color,background-color,box-shadow] duration-150 active:cursor-grabbing ${
                  isSelected || isAssigned
                    ? "border-[#86BDF4] bg-[#F1F8FF] shadow-[0_5px_16px_rgba(77,155,243,.11)]"
                    : "border-[#E4EBF2] bg-white hover:border-[#B9D7F5] hover:bg-[#FBFDFF]"
                }`}
                aria-label={`选择语音包 ${preset.label}`}
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
                      {isSelected ? <Check className="h-3.5 w-3.5 text-[#3987DF]" /> : null}
                    </div>
                    {isAssigned ? (
                      <span className="mt-0.5 block text-[10px] font-medium text-[#3987DF]">
                        已添加 · 槽位 {assignedSlots.join("、")}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[#E1EAF3] bg-white text-[#6B8EAF] transition-colors hover:border-[#A8CFF5] hover:text-[#3987DF]"
                    aria-label={`试听${preset.label}`}
                    disabled={!settings.quickMessages.soundEnabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      playPreset(preset);
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
              没有找到匹配的语音
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
      </SettingsSection>
    </div>
  );
};
