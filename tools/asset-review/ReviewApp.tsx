import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GAME_RULES } from "../../apps/desktop/src/main/game-catalog";
import { GameMonitorContent } from "../../apps/desktop/src/renderer/src/components/room/GameMonitorContent";
import { RoomDateCalendar } from "../../apps/desktop/src/renderer/src/components/room/RoomDateCalendar";
import {
  SceneExitDoor,
  SceneWallClock,
  SceneFloorLamp,
  SceneWallShelf,
  SceneTallPlant,
  SceneLowTable,
  SceneWindowNook,
} from "../../apps/desktop/src/renderer/src/components/room/SceneAmbientDecor";
import { WorkstationArt } from "../../apps/desktop/src/renderer/src/components/room/WorkstationArt";
import { DynamicWeatherWindow } from "../../apps/desktop/src/renderer/src/components/room/DynamicWeatherWindow";
import { useWeatherStore } from "../../apps/desktop/src/renderer/src/features/weather/weatherStore";
import { visualRuntimeController } from "../../apps/desktop/src/renderer/src/features/visual-runtime/VisualRuntimeController";
import type { WeatherDayPhase } from "@private-voice/shared";
import {
  CharacterPreview,
  WeatherPreview,
  characterKinds,
  characterActions,
  weatherScenes,
  MotionPreviewContext,
} from "./MotionPreviews";

type ReviewStatus = "待审核" | "通过" | "需要修改";
interface ReviewNote {
  name: string;
  path: string;
  status: ReviewStatus;
  comment: string;
  updatedAt: string;
}
type ReviewNotes = Record<string, ReviewNote>;
interface ReviewAsset {
  relative: string;
  url: string;
  label: string;
  group: string;
  note: string;
  sourcePath?: string;
}
interface GameSource {
  name: string;
  file: string;
  page: string;
  publisher: string;
  kind: string;
}
interface AssetStudio {
  readNotes(): Promise<ReviewNotes | null>;
  saveNotes(notes: ReviewNotes): Promise<void>;
  exportNotes(notes: ReviewNotes): Promise<boolean>;
  importNotes(): Promise<ReviewNotes | null>;
  downloadAsset(relative: string): Promise<boolean>;
  copyPng(data: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  capture(
    rect: { x: number; y: number; width: number; height: number },
    action: "copy" | "save",
    name: string,
  ): Promise<boolean>;
}
declare global {
  interface Window {
    reviewManifest: {
      version: string;
      generatedAt: string;
      sourceRoot: string;
      packaged?: boolean;
      assets: ReviewAsset[];
      games: GameSource[];
    };
    assetStudio?: AssetStudio;
  }
}
const manifest = window.reviewManifest;
const studio = window.assetStudio;
// The review uses in-memory weather fixtures and has no Electron bridge or room connection.
useWeatherStore.setState({
  refresh: async () => useWeatherStore.getState().snapshot!,
  clear: () => {},
});
useWeatherStore.getState().setPreview({ scene: "clear", phase: "day" });
const base = "apps/desktop/src/renderer/src/";
const raw = (file: string) => manifest.assets.find((item) => item.relative === file)?.url;
const scene = (name: string) => raw(`scenes/shanghao-room/${name}`);
const image = (url: string | undefined, alt: string) => <img src={url} alt={alt} />;
type Card = {
  id: string;
  name: string;
  kind: string;
  path: string;
  note: string;
  content: React.ReactNode;
  url?: string;
  assetRelative?: string;
};
const widgets: Card[] = [
  {
    id: "widget-clock",
    name: "时钟 · 含动态指针",
    kind: "当前组件",
    path: base + "components/room/SceneAmbientDecor.tsx",
    note: "独立表盘图片＋北京时间指针",
    content: (
      <div className="review-clock">
        <SceneWallClock />
      </div>
    ),
  },
  {
    id: "widget-calendar",
    name: "日历 · 含日期文字",
    kind: "当前组件",
    path: base + "components/room/RoomDateCalendar.tsx",
    note: "空白日历原图＋月份、日期、星期",
    content: (
      <div className="review-calendar">
        <RoomDateCalendar />
      </div>
    ),
  },
  {
    id: "widget-window",
    name: "窗户 · 天气与昼夜",
    kind: "当前组件",
    path: base + "components/room/DynamicWeatherWindow.tsx",
    note: "全部天气与昼夜状态在「天气效果」分类中查看。",
    content: (
      <div className="review-window">
        <DynamicWeatherWindow isEnabled />
      </div>
    ),
  },
  {
    id: "widget-door",
    name: "离开区 · 门",
    kind: "当前组件",
    path: base + "assets/scenes/shanghao-room/door.png",
    note: "透明背景原图",
    content: <SceneExitDoor className="review-door" />,
  },
  {
    id: "widget-desk",
    name: "桌面与显示器",
    kind: "当前组件",
    path: base + "components/room/WorkstationArt.tsx",
    note: "工位原图；游戏画面单独叠在屏幕上",
    content: <WorkstationArt className="review-desk" />,
  },
  {
    id: "widget-cabinet",
    name: "房间收藏柜",
    kind: "当前素材",
    path: base + "assets/scenes/shanghao-room/cabinet.png",
    note: "柜体原图，收藏内容另行叠加",
    content: image(scene("cabinet.png"), "收藏柜"),
  },
  {
    id: "widget-environment",
    name: "房间环境底图",
    kind: "当前素材",
    path: base + "assets/scenes/shanghao-room/environment-v3-extended.png",
    note: "当前房间底图，含墙面、地板与场景光线",
    content: image(scene("environment-v3-extended.png"), "环境底图"),
  },
  {
    id: "widget-leaves",
    name: "前景叶子",
    kind: "当前素材",
    path: base + "assets/scenes/shanghao-room/foreground-leaves-v2.png",
    note: "独立透明层，运行时另有边缘渐隐与摆动",
    content: image(scene("foreground-leaves-v2.png"), "前景叶子"),
  },
  {
    id: "widget-curtain",
    name: "窗帘",
    kind: "当前素材",
    path: base + "assets/scenes/shanghao-room/curtain-ceiling-v2.png",
    note: "独立透明层",
    content: image(scene("curtain-ceiling-v2.png"), "窗帘"),
  },
];
const legacy: Card[] = (
  [
    ["旧版窗边", SceneWindowNook],
    ["落地灯", SceneFloorLamp],
    ["墙上置物架", SceneWallShelf],
    ["高盆栽", SceneTallPlant],
    ["小圆桌", SceneLowTable],
  ] as [string, React.ComponentType<{ className?: string }>][]
).map(([name, Component], i) => ({
  id: `legacy-${i}`,
  name,
  kind: "保留组件",
  path: base + "components/room/SceneAmbientDecor.tsx",
  note: "代码保留，当前主房间未使用",
  content: <Component className="review-vector" />,
}));
const games: Card[] = GAME_RULES.map(({ name }) => ({
  id: `game-${name}`,
  name,
  kind: "当前游戏画面",
  path: base + "assets/games/screens/" + manifest.games.find((x) => x.name === name)?.file,
  note: manifest.games.find((x) => x.name === name)?.kind + " · 静态显示画面",
  url: raw("games/screens/" + manifest.games.find((x) => x.name === name)?.file),
  assetRelative: "games/screens/" + manifest.games.find((x) => x.name === name)?.file,
  content: (
    <div className="review-monitor">
      <GameMonitorContent gameName={name} />
    </div>
  ),
}));
const assets: Card[] = manifest.assets.map((item) => ({
  id: `asset-${item.relative}`,
  name: item.label,
  kind: item.group,
  path: item.sourcePath || base + "assets/" + item.relative,
  note: item.note,
  url: item.url,
  assetRelative: item.relative,
  content: image(item.url, item.label),
}));
const weather: Card[] = weatherScenes.map(([scene, label]) => ({
  id: `widget-weather-${scene}`,
  name: label,
  kind: "动态天气",
  path: base + "components/room/DynamicWeatherWindow.tsx",
  note: "切换昼夜查看同一天气；与房间使用相同的动态组件。",
  content: <WeatherPreview scene={scene} />,
}));
const characters: Card[] = characterKinds.map(([avatarId, name]) => ({
  id: `widget-character-${avatarId}`,
  name,
  kind: "角色动作",
  path: base + "components/room/DeskAnimalSprite.tsx",
  note: "正面、坐姿、左右行走、说话、游戏和闲置小动作；原动画保留。",
  content: <CharacterPreview avatarId={avatarId} />,
}));
const brands = assets.filter((item) => item.kind === "品牌图标");
const allCharacterActions: Card[] = characterKinds.flatMap(([avatarId, name]) =>
  characterActions.map(([action, label]) => ({
    id: `widget-character-${avatarId}-${action}`,
    name: `${name} · ${label}`,
    kind: "角色动作",
    path: base + "components/room/DeskAnimalSprite.tsx",
    note: "保留原比例；可暂停、放大和保存审核意见。",
    content: <CharacterPreview avatarId={avatarId} actionOverride={action} />,
  })),
);
const avatars = assets.filter((item) => item.kind === "账号头像");
const storageKey = "shanghao-asset-review-v1";
const readNotes = (): ReviewNotes => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as ReviewNotes)
      : {};
  } catch {
    return {};
  }
};

function ReviewApp() {
  useEffect(() => visualRuntimeController.start(), []);
  const [tab, setTab] = useState("widgets"),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState("全部"),
    [background, setBackground] = useState("light");
  const [notes, setNotes] = useState<ReviewNotes>(() => (studio ? {} : readNotes())),
    [selected, setSelected] = useState<Card>(),
    [comment, setComment] = useState(""),
    [status, setStatus] = useState<ReviewStatus>("待审核"),
    [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [reviewFilter, setReviewFilter] = useState("全部状态");
  const [phase, setPhase] = useState<WeatherDayPhase>("day");
  const [action, setAction] = useState("idle");
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(!studio);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!studio) return;
    let active = true;
    studio
      .readNotes()
      .then((value) => {
        if (active) {
          if (value) setNotes(value);
          setReady(true);
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const source =
    tab === "widgets"
      ? [...widgets, ...legacy]
      : tab === "games"
        ? games
        : tab === "weather"
          ? weather
          : tab === "characters"
            ? action === "all"
              ? allCharacterActions
              : characters
            : tab === "brand"
              ? brands
              : tab === "avatars"
                ? avatars
                : assets;
  const filtered = source.filter(
    (item) =>
      (tab !== "assets" || group === "全部" || item.kind === group) &&
      (reviewFilter === "全部状态" || (notes[item.id]?.status || "待审核") === reviewFilter) &&
      `${item.name} ${item.path} ${item.note}`.toLowerCase().includes(query.toLowerCase()),
  );
  const open = (item: Card) => {
    setSelected(item);
    setComment(notes[item.id]?.comment || "");
    setStatus(notes[item.id]?.status || "待审核");
    dialog.current?.showModal();
  };
  const save = async () => {
    if (!selected || !ready || busy) return;
    const value = {
      ...notes,
      [selected.id]: {
        name: selected.name,
        path: selected.path,
        status,
        comment,
        updatedAt: new Date().toISOString(),
      },
    };
    setBusy(true);
    try {
      if (studio) await studio.saveNotes(value);
      if (!studio) localStorage.setItem(storageKey, JSON.stringify(value));
      setNotes(value);
      setMessage("意见已保存，可导出发给我。");
      dialog.current?.close();
    } catch (error) {
      setMessage(`保存失败：${(error as Error).message}。填写的内容仍保留在这里。`);
    } finally {
      setBusy(false);
    }
  };
  const exportNotes = async () => {
    if (studio) {
      await perform(async () => {
        return (await studio.exportNotes(notes)) ? "审核意见已导出" : "已取消导出";
      });
      return;
    }
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { version: manifest.version, generatedAt: manifest.generatedAt, notes },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "上号素材审核意见.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const perform = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mergeNotes = async (incoming: unknown) => {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
      throw Error("审核文件格式不正确");
    const ids = new Set(
      [
        ...widgets,
        ...legacy,
        ...weather,
        ...characters,
        ...allCharacterActions,
        ...games,
        ...assets,
      ].map((item) => item.id),
    );
    const next = { ...notes };
    let count = 0;
    for (const [id, value] of Object.entries(incoming)) {
      const note = value as ReviewNote;
      if (
        !ids.has(id) ||
        !note ||
        !["待审核", "通过", "需要修改"].includes(note.status) ||
        typeof note.comment !== "string" ||
        note.comment.length > 20000
      )
        continue;
      // A merge must not replace a newer local review with an old backup.
      if (!next[id] || (Date.parse(note.updatedAt) || 0) > (Date.parse(next[id].updatedAt) || 0)) {
        next[id] = note;
        count++;
      }
    }
    if (studio) await studio.saveNotes(next);
    if (!studio) localStorage.setItem(storageKey, JSON.stringify(next));
    setNotes(next);
    setReady(true);
    return `已合并 ${count} 条审核意见；较新的本地意见已保留。`;
  };
  const importNotes = () => {
    if (!studio) {
      importInput.current?.click();
      return;
    }
    void perform(async () => {
      const value = await studio.importNotes();
      return value ? mergeNotes(value) : "已取消导入";
    });
  };
  const download = (item: Card) =>
    perform(async () => {
      if (!item.url) throw Error("请先放大该组件，再选择“下载效果图”。");
      if (studio)
        return (await studio.downloadAsset(item.assetRelative ?? item.url.replace("./assets/", "")))
          ? "素材已保存"
          : "已取消保存";
      const link = document.createElement("a");
      link.href = item.url;
      link.download = item.url.split("/").pop()!;
      link.click();
      return "已开始下载素材";
    });
  const copy = (item: Card) =>
    perform(async () => {
      if (!item.url) throw Error("请先放大该组件，再选择“复制效果图”。");
      const image = new Image();
      image.src = item.url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("无法创建图片");
      ctx.drawImage(image, 0, 0);
      if (studio) await studio.copyPng(canvas.toDataURL("image/png"));
      else {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
        if (!blob) throw Error("图片转换失败");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      }
      return "图片已复制，可以粘贴到聊天、画图或设计软件。";
    });
  const capture = (action: "copy" | "save") =>
    perform(async () => {
      if (!studio) throw Error("组件效果图的复制和下载，请从桌面的“上号素材”打开。");
      const rect = preview.current?.getBoundingClientRect();
      if (!rect || !selected) throw Error("请先打开素材");
      const done = await studio.capture(
        { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        action,
        selected.name,
      );
      return done ? (action === "copy" ? "效果图已复制" : "效果图已保存") : "已取消保存";
    });
  const motionControls = (kind: string) => (
    <>
      {kind === "weather" && (
        <label>
          昼夜
          <select
            aria-label="天气昼夜"
            value={phase}
            onChange={(e) => setPhase(e.target.value as WeatherDayPhase)}
          >
            <option value="dawn">黎明</option>
            <option value="day">白天</option>
            <option value="dusk">黄昏</option>
            <option value="night">夜晚</option>
          </select>
        </label>
      )}
      {kind === "characters" && (
        <label>
          角色动作
          <select aria-label="角色动作" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="all">全部动作</option>
            {characterActions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {["weather", "characters"].includes(kind) && (
        <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? "继续动画" : "暂停动画"}
        </button>
      )}
    </>
  );
  return (
    <MotionPreviewContext.Provider value={{ phase, action, paused }}>
      <main className={`asset-review review-background-${background}`}>
        <header className="review-header">
          <div>
            <p className="review-eyebrow">SHANGHAO · ASSET STUDIO</p>
            <h1>上号素材</h1>
            <p>
              {manifest.packaged ? "上号" : "开发预览"} {manifest.version} · {games.length} 款游戏 ·{" "}
              {assets.length} 份图片
            </p>
          </div>
          <div className="review-actions">
            <span className="review-local">
              {studio ? "本地工作室 · 审核记录保存在本机" : "浏览器预览 · 完整功能请打开桌面工作室"}
            </span>
            <button onClick={importNotes} disabled={busy}>
              导入意见
            </button>
            <button onClick={exportNotes} disabled={busy}>
              导出意见（{Object.keys(notes).length}）
            </button>
            <input
              hidden
              ref={importInput}
              type="file"
              accept=".json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void perform(async () => {
                    if (file.size > 5 * 1024 * 1024) throw Error("文件过大");
                    return mergeNotes(JSON.parse(await file.text()).notes);
                  });
                event.target.value = "";
              }}
            />
          </div>
        </header>
        <nav className="review-tabs" aria-label="素材分类">
          {[
            ["brand", "品牌图标"],
            ["widgets", "房间组件"],
            ["weather", "天气效果"],
            ["characters", "角色动作"],
            ["games", "游戏显示器"],
            ["avatars", "账号头像"],
            ["assets", "原始素材"],
          ].map(([id = "widgets", label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                setQuery("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="review-controls">
          <label>
            搜索
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：时钟、英雄联盟、窗户、fox"
            />
          </label>
          {tab === "assets" && (
            <label>
              图片分类
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                {["全部", ...new Set(assets.map((item) => item.kind))].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            审核进度
            <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
              {["全部状态", "待审核", "需要修改", "通过"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            预览底色
            <select value={background} onChange={(e) => setBackground(e.target.value)}>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
              <option value="grid">透明格</option>
            </select>
          </label>
          {motionControls(tab)}
          <span>{filtered.length} 项</span>
        </div>
        <p className="review-info">
          {tab === "games"
            ? "每款游戏都有独立画面。点击卡片查看放大效果与房间实际小屏尺寸；来源链接、原图和审核意见都在详情里。"
            : "点击卡片放大审核，可复制图片或下载原图。时钟、日历等组合组件也能导出当前效果。"}
        </p>
        <p role="status" className="review-status">
          {message}
        </p>
        <section className="review-grid">
          {filtered.map((item) => (
            <article className="review-card" key={item.id}>
              <button
                className="review-preview"
                aria-label={`放大并审核${item.name}`}
                onClick={() => open(item)}
              >
                {item.content}
              </button>
              <div className="review-card-body">
                <div className="review-kind">
                  {item.kind}
                  <span>{notes[item.id]?.status || "待审核"}</span>
                </div>
                <h2>{item.name}</h2>
                <p>{item.note}</p>
                <div className="review-card-actions">
                  <button onClick={() => open(item)}>查看 / 审核</button>
                  {item.url && (
                    <>
                      <button disabled={busy} onClick={() => void copy(item)}>
                        复制
                      </button>
                      <button disabled={busy} onClick={() => void download(item)}>
                        下载
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
        {!filtered.length && <p>没有匹配的素材，请换一个关键词。</p>}
        <dialog ref={dialog} className="review-dialog" onCancel={() => setSelected(undefined)}>
          <div className="review-dialog-head">
            <h2>{selected?.name}</h2>
            <button onClick={() => dialog.current?.close()}>关闭</button>
          </div>
          <div className="review-controls">
            {motionControls(
              selected?.kind === "动态天气"
                ? "weather"
                : selected?.kind === "角色动作"
                  ? "characters"
                  : "",
            )}
          </div>
          <div ref={preview} className="review-enlarged">
            {selected?.content}
          </div>
          {selected?.id.startsWith("game-") && (
            <div className="review-size-check">
              <span>房间小屏 · 110 × 70</span>
              <div className="review-monitor review-monitor-actual">
                <GameMonitorContent gameName={selected.name} />
              </div>
            </div>
          )}
          <p>{selected?.note}</p>
          <div className="review-card-actions">
            {selected?.url && (
              <>
                <button disabled={busy} onClick={() => void copy(selected)}>
                  复制素材
                </button>
                <button disabled={busy} onClick={() => void download(selected)}>
                  下载素材
                </button>
              </>
            )}
            <button disabled={busy} onClick={() => void capture("copy")}>
              复制效果图
            </button>
            <button disabled={busy} onClick={() => void capture("save")}>
              下载效果图
            </button>
          </div>
          <details>
            <summary>素材来源与文件位置</summary>
            <code>{selected?.path}</code>
            {selected?.id.startsWith("game-") && (
              <p>
                {manifest.games.find((x) => x.name === selected.name)?.publisher} ·{" "}
                <a
                  href={manifest.games.find((x) => x.name === selected.name)?.page}
                  target="_blank"
                  rel="noreferrer"
                >
                  官方来源
                </a>
              </p>
            )}
            <button
              onClick={() =>
                void perform(async () => {
                  const location = manifest.packaged
                    ? `https://github.com/soberbw-hash/shanghao/blob/v${manifest.version}/${selected?.path}`
                    : manifest.sourceRoot + "/" + selected?.path;
                  if (studio) await studio.copyText(location);
                  else await navigator.clipboard.writeText(location);
                  return "文件路径已复制";
                })
              }
            >
              复制文件路径
            </button>
          </details>
          <p role="status" className="review-status">
            {message}
          </p>
          <label>
            审核结果
            <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)}>
              <option>待审核</option>
              <option>通过</option>
              <option>需要修改</option>
            </select>
          </label>
          <label>
            修改意见
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例如：时钟外圈太厚，希望细一点。"
            />
          </label>
          <button className="review-primary" disabled={!ready || busy} onClick={save}>
            保存意见
          </button>
        </dialog>
        <footer>
          素材快照：{new Date(manifest.generatedAt).toLocaleString("zh-CN")}
          。审核记录保存在本机；导出意见可用于备份和交接。
        </footer>
      </main>
    </MotionPreviewContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<ReviewApp />);
