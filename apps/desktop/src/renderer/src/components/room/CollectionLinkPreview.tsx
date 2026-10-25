import { useEffect, useState } from "react";
import { Globe2, Link2, Music2 } from "lucide-react";
import { identifyMusicLink } from "../../features/chat/musicLink";
import { formatCompactUrl, getMessageUrlDetails } from "../../features/chat/linkPreview";

type Preview = Awaited<ReturnType<Window["desktopApi"]["app"]["getChatLinkPreview"]>>;

export const CollectionLinkPreview = ({
  url,
  title,
  onOpen,
}: {
  url: string;
  title: string;
  onOpen: (url: string) => void;
}) => {
  const [result, setResult] = useState<{ url: string; preview: Preview; loading: boolean }>();
  const [failedImage, setFailedImage] = useState<string>();
  useEffect(() => {
    let active = true;
    setResult({ url, preview: {}, loading: true });
    void window.desktopApi.app.getChatLinkPreview(url).then(
      (preview) => {
        if (active) setResult({ url, preview, loading: false });
      },
      () => {
        if (active) setResult({ url, preview: {}, loading: false });
      },
    );
    return () => {
      active = false;
    };
  }, [url]);
  const preview = result?.url === url ? result.preview : {};
  const loading = result?.url !== url || result.loading;
  const hostname = getMessageUrlDetails(url)?.hostname ?? "网页链接";
  const music = identifyMusicLink(url);
  const heading = preview.title || title || hostname;
  const image = preview.imageDataUrl !== failedImage ? preview.imageDataUrl : undefined;
  return (
    <button
      type="button"
      className="collection-link-preview"
      title={url}
      aria-label={`在浏览器中打开 ${heading}`}
      onClick={() => onOpen(url)}
    >
      <span
        className={`collection-link-art ${preview.imageKind === "icon" ? "is-site-icon" : ""}`}
        aria-hidden="true"
      >
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedImage(image)}
          />
        ) : music ? (
          <Music2 />
        ) : (
          <Link2 />
        )}
      </span>
      <span className="collection-link-details">
        <span className="collection-link-site">
          <Globe2 aria-hidden="true" />
          {music?.platform || preview.siteName || hostname}
        </span>
        <strong>{heading}</strong>
        <span className="collection-link-description" aria-live="polite">
          {preview.description ||
            (loading ? "正在读取信息…" : music ? "打开音乐平台收听" : "点击查看原文")}
        </span>
        <span className="collection-link-address">{formatCompactUrl(url)}</span>
      </span>
    </button>
  );
};
