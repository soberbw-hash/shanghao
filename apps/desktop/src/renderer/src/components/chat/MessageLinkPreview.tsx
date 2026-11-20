import { useEffect, useState } from "react";
import { ExternalLink, Github, Link2, Music2 } from "lucide-react";
import { identifyMusicLink } from "../../features/chat/musicLink";
import { getMessageUrlDetails, formatCompactUrl } from "../../features/chat/linkPreview";
import { writeRoomCollectionDragPayload } from "../../features/chat/collectionDrag";

export const MessageLinkPreview = ({
  url,
  caption,
  onCopy,
}: {
  url: string;
  caption?: string;
  onCopy: (url: string) => void;
}) => {
  const details = getMessageUrlDetails(url);
  const music = identifyMusicLink(url);
  const [result, setResult] = useState<{ url: string; title?: string; imageDataUrl?: string }>();
  const preview = result?.url === url ? result : undefined;

  useEffect(() => {
    let active = true;
    void window.desktopApi.app
      .getChatLinkPreview(url, "icon")
      .then((result) => {
        if (active) setResult({ url, ...result });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [url]);

  if (!details) return null;
  const compactUrl = formatCompactUrl(url);
  const label = caption ?? preview?.title;
  const displayTitle = label ?? (music ? `${music.platform} · 分享的音乐` : details.hostname);

  return (
    <button
      type="button"
      className={`chat-link-preview${music ? " chat-music-preview" : ""}`}
      draggable
      aria-label={
        music
          ? `在 ${music.platform} 收听${label ? ` ${label}` : ""}`
          : `在浏览器中打开 ${details.hostname}${label ? `，${label}` : ""}`
      }
      title={label ? `${label}\n${url}` : url}
      onClick={() => void window.desktopApi.app.openExternal(url)}
      onContextMenu={(event) => {
        event.preventDefault();
        onCopy(url);
      }}
      onDragStart={(event) => {
        writeRoomCollectionDragPayload(event.dataTransfer, {
          kind: "link",
          title: caption ?? preview?.title ?? music?.platform ?? details.hostname,
          content: url,
        });
      }}
    >
      <span className="chat-link-preview-image" aria-hidden="true">
        {details.hostname === "github.com" ? (
          <Github className="text-[#24292f]" />
        ) : preview?.imageDataUrl ? (
          <img
            src={preview.imageDataUrl}
            alt=""
            className="!h-6 !w-6 !object-contain"
            onError={() => setResult({ url, title: preview.title })}
          />
        ) : music ? (
          <Music2 />
        ) : (
          <Link2 />
        )}
      </span>
      <span className="chat-link-preview-copy">
        <strong>{displayTitle}</strong>
        <small>
          {music
            ? `${music.platform} · 打开收听`
            : compactUrl === details.hostname
              ? "点击打开网页"
              : compactUrl}
        </small>
      </span>
      <ExternalLink className="chat-link-preview-open" aria-hidden="true" />
    </button>
  );
};
