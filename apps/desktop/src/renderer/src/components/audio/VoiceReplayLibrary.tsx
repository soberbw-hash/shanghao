import { useEffect, useRef, useState } from "react";
import type { VoiceReplayClip } from "@private-voice/shared";
import { Button } from "../base/Button";

export function VoiceReplayLibrary({ revision }: { revision: string | number }) {
  const [clips, setClips] = useState<VoiceReplayClip[]>([]);
  const [selected, setSelected] = useState<VoiceReplayClip>();
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("0");
  const [to, setTo] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<string>();
  const request = useRef(0);
  const transcriptRequest = useRef(0);
  const listRequest = useRef(0);
  const operation = useRef(false);
  const lifecycle = useRef({ active: true });
  useEffect(() => {
    const owner = { active: true };
    lifecycle.current = owner;
    return () => {
      owner.active = false;
    };
  }, []);
  const api = window.desktopApi.voiceReplay;
  const refresh = async (owner: { active: boolean }) => {
    if (!api) return;
    const id = ++listRequest.current;
    const result = await api.list();
    if (owner.active && id === listRequest.current) setClips(result);
  };
  useEffect(() => {
    let active = true;
    const id = ++listRequest.current;
    void api
      ?.list()
      .then((result) => {
        if (active && id === listRequest.current) setClips(result);
      })
      .catch(() => {
        if (active && id === listRequest.current) setError("片段库暂时无法读取，原文件已保留。");
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const select = async (clip: VoiceReplayClip, fromAction = false) => {
    if (operation.current && !fromAction) return;
    const current = ++request.current;
    const transcriptVersion = ++transcriptRequest.current;
    const owner = lifecycle.current;
    setSelected(clip);
    setTranscript(undefined);
    setError("");
    setTitle(clip.title);
    // Never round the default past the actual end: the store rejects out-of-range cuts.
    setFrom("0");
    setTo(String(Math.floor(clip.durationMs * 1000) / 1_000_000));
    setUrl("");
    if (api?.readTranscript)
      void api
        .readTranscript(clip.id)
        .then((text) => {
          if (
            owner.active &&
            current === request.current &&
            transcriptVersion === transcriptRequest.current &&
            text !== undefined
          )
            setTranscript(text || "没有识别到语音。");
        })
        .catch(() => {
          if (
            owner.active &&
            current === request.current &&
            transcriptVersion === transcriptRequest.current
          )
            setError("本地文字暂时无法读取，原文件已保留。");
        });
    try {
      const data = await api?.read(clip.id);
      if (owner.active && current === request.current && data)
        setUrl(URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: "audio/wav" })));
    } catch {
      if (owner.active && current === request.current)
        setError("这个片段暂时无法回听，原文件已保留。");
    }
  };
  const action = async (run: (active: () => boolean) => Promise<unknown>) => {
    if (operation.current) return;
    operation.current = true;
    const owner = lifecycle.current;
    setBusy(true);
    setError("");
    try {
      await run(() => owner.active);
      if (owner.active) await refresh(owner);
    } catch {
      if (owner.active) setError("操作未完成。请检查文件是否被占用，导出时请使用新文件名。");
    } finally {
      operation.current = false;
      if (owner.active) setBusy(false);
    }
  };
  return (
    <section className="voice-replay-library" aria-label="本机精彩片段">
      <h3>
        精彩片段 <span>{clips.length}</span>
      </h3>
      {!clips.length && <p>保存的回溯会出现在这里，仅存本机。</p>}
      <div className="voice-replay-clips">
        {clips.map((clip) => (
          <button
            key={clip.id}
            className={selected?.id === clip.id ? "is-selected" : ""}
            disabled={busy}
            onClick={() => void select(clip)}
          >
            <strong>{clip.title}</strong>
            <small>
              {new Date(clip.createdAt).toLocaleDateString("zh-CN")} ·{" "}
              {(clip.durationMs / 1000).toFixed(1)} 秒
            </small>
          </button>
        ))}
      </div>
      {selected && (
        <div className="voice-replay-editor">
          {url && <audio controls src={url} aria-label={selected.title} />}
          <label>
            名称
            <input
              value={title}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="voice-replay-actions">
            <Button
              className="text-xs"
              disabled={busy}
              onClick={() =>
                void action(async (active) => {
                  ++transcriptRequest.current;
                  if (!api?.transcribeLocal) {
                    if (active()) setError("请重启上号后使用本地转录。");
                    return;
                  }
                  try {
                    const text = await api.transcribeLocal(selected.id);
                    if (active()) setTranscript(text || "没有识别到语音。");
                  } catch {
                    if (active())
                      setError("本地转录未完成，请检查模型或本机存储后重试；原片段已保留。");
                  }
                })
              }
            >
              本地转文字
            </Button>
            <Button
              className="text-xs"
              disabled={busy || !title.trim()}
              onClick={() =>
                void action(async (active) => {
                  await api?.rename(selected.id, title);
                  if (active()) setSelected({ ...selected, title });
                })
              }
            >
              保存名称
            </Button>
            <Button
              className="text-xs"
              disabled={busy}
              onClick={() => void action(() => api!.export(selected.id))}
            >
              导出
            </Button>
            <Button
              className="text-xs"
              disabled={busy}
              onClick={() =>
                void action(async (active) => {
                  await api?.remove(selected.id);
                  if (active()) {
                    request.current++;
                    setSelected(undefined);
                    setUrl("");
                  }
                })
              }
            >
              移到系统回收站
            </Button>
          </div>
          {transcript !== undefined && (
            <div aria-label="本地转录文字">
              <strong>转录文字</strong>
              <p>{transcript}</p>
              <small>文字和原片段均保存在本机。</small>
            </div>
          )}
          <div className="voice-replay-trim">
            <label>
              起点（秒）
              <input
                type="number"
                min="0"
                step="0.1"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              终点（秒）
              <input
                type="number"
                min="0"
                step="0.1"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button
              className="text-xs"
              disabled={busy}
              onClick={() =>
                void action(async (active) => {
                  const next = await api!.trim(selected.id, Number(from) * 1000, Number(to) * 1000);
                  if (active()) await select(next, true);
                })
              }
            >
              另存裁剪
            </Button>
          </div>
          <small>裁剪另存一份，原片段保留。分享或二次使用前请征得相关成员同意。</small>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
