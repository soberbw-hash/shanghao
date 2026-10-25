import { useEffect, useState } from "react";
import { ExternalLink, Link2, Music2 } from "lucide-react";
import { identifyMusicLink } from "../../features/chat/musicLink";
import { getMessageUrlDetails, formatCompactUrl } from "../../features/chat/linkPreview";
import { writeRoomCollectionDragPayload } from "../../features/chat/collectionDrag";

export const MessageLinkPreview = ({
  url,
  onCopy,
}: {
  url: string;
  onCopy: (url: string) => void;
}) => {
  const details = getMessageUrlDetails(url);
  const music = identifyMusicLink(url);
  const [preview, setPreview] = useState<{ title?: string; imageDataUrl?: string }>({});

  useEffect(() => {
    let active = true;
    setPreview({});
    void window.desktopApi.app
      .getChatLinkPreview(url)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [url]);

  if (!details) return null;
  const compactUrl = formatCompactUrl(url);

  return (
    <button
      type="button"
      className={`chat-link-preview${music ? " chat-music-preview" : ""}`}
      draggable
      aria-label={
        music
          ? `在 ${music.platform} 收听${preview.title ? ` ${preview.title}` : ""}`
          : `在浏览器中打开 ${details.hostname}`
      }
      title={url}
      onClick={() => void window.desktopApi.app.openExternal(url)}
      onContextMenu={(event) => {
        event.preventDefault();
        onCopy(url);
      }}
      onDragStart={(event) => {
        writeRoomCollectionDragPayload(event.dataTransfer, {
          kind: "link",
          title: preview.title ?? music?.platform ?? details.hostname,
          content: url,
        });
      }}
    >
      <span className="chat-link-preview-image" aria-hidden="true">
        {preview.imageDataUrl ? (
          <img src={preview.imageDataUrl} alt="" />
        ) : music ? (
          <Music2 />
        ) : (
          <Link2 />
        )}
      </span>
      <span className="chat-link-preview-copy">
        <strong>
          {preview.title ?? (music ? `${music.platform} · 分享的音乐` : details.hostname)}
        </strong>
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
